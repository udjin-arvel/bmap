package handlers

import (
	"bytes"
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"

	"bmap-api/apperr"
	"bmap-api/auth"
)

var upgrader = websocket.Upgrader{
	// Как и в Starlette, Origin не проверяется: доступ ограничен токеном редактора.
	CheckOrigin: func(*http.Request) bool { return true },
}

// EditorWS — GET /api/ws?token=... (только editor).
func (a *API) EditorWS(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "Недостаточно прав", http.StatusForbidden)
		return
	}
	u, err := a.Tokens.Decode(token)
	if err != nil {
		// Аналог websocket.close(4403) до accept: рукопожатие отклоняется с 403.
		http.Error(w, "Недостаточно прав", http.StatusForbidden)
		return
	}
	row, err := a.Store.GetUserByUsername(u.Username)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if row == nil || row.Role != auth.RoleEditor {
		http.Error(w, "Недостаточно прав", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("ws upgrade failed", "err", err)
		return
	}
	client := a.Hub.Register(conn)
	defer func() {
		a.Hub.Unregister(client)
		_ = conn.Close()
	}()
	client.KeepAlive()
}

// AIOutgoing — GET /api/nodes/{id}/ai-outgoing.
func (a *API) AIOutgoing(w http.ResponseWriter, r *http.Request) {
	has, err := a.Expander.HasAIOutgoing(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"hasAiOutgoing": has})
}

// ExpandNode — POST /api/nodes/{id}/expand (editor). Тело {"force": bool}.
func (a *API) ExpandNode(w http.ResponseWriter, r *http.Request) {
	force := false
	raw, err := readBody(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if len(bytes.TrimSpace(raw)) > 0 {
		o, err := parseObject(raw, []any{"body"})
		if err != nil {
			writeError(w, r, err)
			return
		}
		if v, _ := o.optBool("force"); v != nil {
			force = *v
		}
		if err := o.err(); err != nil {
			writeError(w, r, err)
			return
		}
	}

	jobID, err := a.Expander.StartExpand(r.Context(), r.PathValue("id"), force)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"jobId": jobID})
}

// GetJob — GET /api/ai/jobs/{id} (editor).
func (a *API) GetJob(w http.ResponseWriter, r *http.Request) {
	job, ok := a.Jobs.Get(r.PathValue("id"))
	if !ok {
		writeError(w, r, apperr.New(http.StatusNotFound, "UNKNOWN", "Задача не найдена"))
		return
	}
	writeJSON(w, http.StatusOK, job)
}
