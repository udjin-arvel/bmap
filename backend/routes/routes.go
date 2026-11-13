// Package routes — таблица маршрутов (совпадает с backend-python).
package routes

import (
	"net/http"

	"bmap-api/handlers"
)

func New(a *handlers.API) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", a.Health)

	// auth
	mux.HandleFunc("POST /api/auth/register", a.Register)
	mux.HandleFunc("POST /api/auth/login", a.Login)
	mux.HandleFunc("GET /api/auth/me", a.Me)

	// graph (чтение — публично, запись — editor)
	mux.HandleFunc("GET /api/graph/roots", a.GraphRoots)
	mux.HandleFunc("GET /api/graph", a.GetGraph)
	mux.HandleFunc("GET /api/nodes/{id}", a.GetNode)
	mux.HandleFunc("POST /api/nodes", a.EditorOnly(a.CreateNode))
	mux.HandleFunc("PATCH /api/nodes/{id}", a.EditorOnly(a.PatchNode))
	mux.HandleFunc("DELETE /api/nodes/{id}", a.EditorOnly(a.DeleteNode))
	mux.HandleFunc("POST /api/nodes/batch-patch", a.EditorOnly(a.BatchPatch))
	mux.HandleFunc("POST /api/edges", a.EditorOnly(a.CreateEdge))
	mux.HandleFunc("DELETE /api/edges/{id}", a.EditorOnly(a.DeleteEdge))

	// ai
	mux.HandleFunc("GET /api/nodes/{id}/ai-outgoing", a.AIOutgoing)
	mux.HandleFunc("POST /api/nodes/{id}/expand", a.EditorOnly(a.ExpandNode))
	mux.HandleFunc("GET /api/ai/jobs/{id}", a.EditorOnly(a.GetJob))
	mux.HandleFunc("GET /api/ws", a.EditorWS)

	mux.HandleFunc("/", handlers.NotFound)
	return mux
}
