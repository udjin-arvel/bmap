// Package config загружает настройки из переменных окружения и .env
// (аналог pydantic-settings в backend-python/app/config.py).
package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

type Settings struct {
	Neo4jURI      string
	Neo4jUser     string
	Neo4jPassword string

	JWTSecret      string
	JWTAlgorithm   string
	JWTExpireHours int

	EditorKey          string
	SQLitePath         string
	SeedViewerPassword string

	CORSOrigins []string

	DeepSeekAPIKey  string
	DeepSeekBaseURL string
	DeepSeekModel   string
}

// Load читает настройки. Приоритет: переменные окружения > .env > значения по умолчанию.
// .env ищется в текущей папке, затем в родительской (корень репозитория при запуске из backend/).
func Load() *Settings {
	dotenv := map[string]string{}
	for _, p := range []string{".env", "../.env"} {
		if m, err := readDotEnv(p); err == nil {
			dotenv = m
			break
		}
	}

	get := func(key, def string) string {
		if v, ok := os.LookupEnv(key); ok {
			return v
		}
		if v, ok := dotenv[key]; ok {
			return v
		}
		return def
	}

	expire, err := strconv.Atoi(get("JWT_EXPIRE_HOURS", "24"))
	if err != nil || expire <= 0 {
		expire = 24
	}

	var origins []string
	for _, o := range strings.Split(get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:18480,http://localhost:18480"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}

	return &Settings{
		Neo4jURI:           get("NEO4J_URI", "bolt://localhost:7687"),
		Neo4jUser:          get("NEO4J_USER", "neo4j"),
		Neo4jPassword:      get("NEO4J_PASSWORD", "neo4j"),
		JWTSecret:          get("JWT_SECRET", "change-me-jwt-secret"),
		JWTAlgorithm:       get("JWT_ALGORITHM", "HS256"),
		JWTExpireHours:     expire,
		EditorKey:          get("EDITOR_KEY", "change-me-editor-key"),
		SQLitePath:         get("SQLITE_PATH", "./data/app.db"),
		SeedViewerPassword: get("SEED_VIEWER_PASSWORD", "viewer"),
		CORSOrigins:        origins,
		DeepSeekAPIKey:     get("DEEPSEEK_API_KEY", ""),
		DeepSeekBaseURL:    get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
		DeepSeekModel:      get("DEEPSEEK_MODEL", "deepseek-chat"),
	}
}

func readDotEnv(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return parseDotEnv(bufio.NewScanner(f)), nil
}

func parseDotEnv(sc *bufio.Scanner) map[string]string {
	out := map[string]string{}
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.ToUpper(strings.TrimSpace(key))
		val = strings.TrimSpace(val)
		if n := len(val); n >= 2 && (val[0] == '"' || val[0] == '\'') && val[n-1] == val[0] {
			val = val[1 : n-1]
		} else if i := strings.Index(val, " #"); i >= 0 {
			val = strings.TrimSpace(val[:i])
		}
		out[key] = val
	}
	return out
}
