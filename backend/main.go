package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"bmap-api/ai"
	"bmap-api/auth"
	"bmap-api/config"
	"bmap-api/db"
	"bmap-api/graph"
	"bmap-api/handlers"
	"bmap-api/routes"
	"bmap-api/seeds"
)

func main() {
	defaultPort := 8000
	if p, err := strconv.Atoi(os.Getenv("PORT")); err == nil && p > 0 {
		defaultPort = p
	}
	var (
		port  int
		host  string
		debug bool
	)
	flag.IntVar(&port, "port", defaultPort, "HTTP server port")
	flag.IntVar(&port, "p", defaultPort, "HTTP server port (shorthand)")
	flag.StringVar(&host, "host", "0.0.0.0", "HTTP listen host")
	flag.BoolVar(&debug, "debug", false, "Log every request")
	flag.BoolVar(&debug, "d", false, "Log every request (shorthand)")
	flag.Parse()

	cfg := config.Load()
	if err := run(cfg, net.JoinHostPort(host, strconv.Itoa(port)), debug); err != nil {
		slog.Error("server stopped with error", "err", err)
		os.Exit(1)
	}
}

func run(cfg *config.Settings, addr string, debug bool) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// --- startup ---
	store, err := db.OpenSQLite(cfg.SQLitePath)
	if err != nil {
		return err
	}
	defer store.Close()
	if err := store.SeedUsers(cfg.SeedViewerPassword); err != nil {
		return err
	}
	slog.Info("SQLite инициализирована", "path", cfg.SQLitePath)

	initCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	driver, err := db.OpenNeo4j(initCtx, cfg.Neo4jURI, cfg.Neo4jUser, cfg.Neo4jPassword)
	if err != nil {
		return err
	}
	defer driver.Close(context.Background())
	slog.Info("Neo4j драйвер инициализирован", "uri", cfg.Neo4jURI)

	graphSvc := graph.NewService(driver, store)
	if err := graphSvc.EnsureSchema(initCtx); err != nil {
		return err
	}
	if err := graphSvc.ApplyBaseSeeds(initCtx, seeds.BaseMarkets); err != nil {
		return err
	}

	hub := ai.NewHub()
	jobs := ai.NewJobStore()
	api := &handlers.API{
		Cfg:    cfg,
		Store:  store,
		Neo4j:  driver,
		Tokens: &auth.Tokens{Secret: []byte(cfg.JWTSecret), Algorithm: cfg.JWTAlgorithm, ExpireHours: cfg.JWTExpireHours},
		Graph:  graphSvc,
		Expander: &ai.Expander{
			Graph: graphSvc,
			Jobs:  jobs,
			Hub:   hub,
			AI:    ai.NewDeepSeek(cfg.DeepSeekAPIKey, cfg.DeepSeekBaseURL, cfg.DeepSeekModel),
		},
		Jobs: jobs,
		Hub:  hub,
	}

	var handler http.Handler = routes.New(api)
	handler = handlers.CORS(cfg.CORSOrigins)(handler)
	if debug {
		handler = handlers.Logging(handler)
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("BMap API слушает", "addr", addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		slog.Info("Остановка сервера...")
	}

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	hub.CloseAll()
	err = srv.Shutdown(shutdownCtx)
	slog.Info("Ресурсы освобождены")
	return err
}
