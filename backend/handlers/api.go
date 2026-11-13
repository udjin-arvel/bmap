// Package handlers — HTTP-хендлеры API (совместимы по маршрутам и форматам с backend-python).
package handlers

import (
	"net/http"
	"strings"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"bmap-api/ai"
	"bmap-api/apperr"
	"bmap-api/auth"
	"bmap-api/config"
	"bmap-api/db"
	"bmap-api/graph"
)

type API struct {
	Cfg      *config.Settings
	Store    *db.Store
	Neo4j    neo4j.DriverWithContext
	Tokens   *auth.Tokens
	Graph    *graph.Service
	Expander *ai.Expander
	Jobs     *ai.JobStore
	Hub      *ai.Hub
}

// Health — GET /api/health.
func (a *API) Health(w http.ResponseWriter, r *http.Request) {
	neoOK := db.PingNeo4j(r.Context(), a.Neo4j)
	sqlOK := a.Store.Ping()
	status := "ok"
	if !neoOK || !sqlOK {
		status = "degraded"
	}
	okStr := func(b bool) string {
		if b {
			return "ok"
		}
		return "error"
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status": status,
		"neo4j":  okStr(neoOK),
		"sqlite": okStr(sqlOK),
	})
}

// NotFound — ответ для неизвестных маршрутов, как в Okapi.
func NotFound(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Не найдено"})
}

func unauthorized(detail string) error {
	return apperr.New(http.StatusUnauthorized, "UNAUTHORIZED", detail)
}

// rawToken: заголовок "Authorization: Bearer <t>", иначе query-параметр ?token=.
func rawToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); h != "" {
		scheme, cred, ok := strings.Cut(h, " ")
		if ok && strings.EqualFold(scheme, "bearer") && cred != "" {
			return cred
		}
	}
	return r.URL.Query().Get("token")
}

// currentUser — get_current_user: проверяет токен и берёт актуальную роль из БД.
func (a *API) currentUser(r *http.Request) (auth.User, error) {
	raw := rawToken(r)
	if raw == "" {
		return auth.User{}, unauthorized("Требуется авторизация")
	}
	u, err := a.Tokens.Decode(raw)
	if err != nil {
		return auth.User{}, err
	}
	row, err := a.Store.GetUserByUsername(u.Username)
	if err != nil {
		return auth.User{}, err
	}
	if row == nil {
		return auth.User{}, unauthorized("Пользователь не найден")
	}
	return auth.User{Username: u.Username, Role: row.Role}, nil
}

func (a *API) requireEditor(r *http.Request) (auth.User, error) {
	u, err := a.currentUser(r)
	if err != nil {
		return u, err
	}
	if u.Role != auth.RoleEditor {
		return u, apperr.New(http.StatusForbidden, "FORBIDDEN", "Нужна роль редактора")
	}
	return u, nil
}

// EditorOnly оборачивает хендлер проверкой роли editor.
func (a *API) EditorOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := a.requireEditor(r); err != nil {
			writeError(w, r, err)
			return
		}
		h(w, r)
	}
}
