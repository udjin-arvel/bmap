package handlers

import (
	"net/http"
	"strings"

	"bmap-api/apperr"
	"bmap-api/auth"
	"bmap-api/db"
)

type loginResponse struct {
	AccessToken string `json:"access_token"`
	Role        string `json:"role"`
}

// Register — POST /api/auth/register (201).
func (a *API) Register(w http.ResponseWriter, r *http.Request) {
	o, err := parseBodyObject(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	username := o.reqString("username", 1, 64)
	password := o.reqString("password", 4, 128)
	if err := o.err(); err != nil {
		writeError(w, r, err)
		return
	}

	username = strings.TrimSpace(username)
	if username == "" {
		writeError(w, r, apperr.New(http.StatusUnprocessableEntity, "VALIDATION_ERROR", "Укажите логин"))
		return
	}
	existing, err := a.Store.GetUserByUsername(username)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if existing != nil {
		writeError(w, r, apperr.New(http.StatusConflict, "USERNAME_TAKEN", "Такой логин уже занят"))
		return
	}
	if err := a.Store.CreateUser(username, password, auth.RoleViewer); err != nil {
		writeError(w, r, err)
		return
	}
	token, err := a.Tokens.Create(username, auth.RoleViewer)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, loginResponse{AccessToken: token, Role: auth.RoleViewer})
}

// Login — POST /api/auth/login. Верный editorKey повышает роль до editor.
func (a *API) Login(w http.ResponseWriter, r *http.Request) {
	o, err := parseBodyObject(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	username := o.reqString("username", 1, 0)
	password := o.reqString("password", 1, 0)
	editorKey, _ := o.optString("editorKey", 0)
	if err := o.err(); err != nil {
		writeError(w, r, err)
		return
	}

	username = strings.TrimSpace(username)
	row, err := a.Store.GetUserByUsername(username)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if row == nil || !db.VerifyPassword(password, row.PasswordHash) {
		writeError(w, r, unauthorized("Неверный логин или пароль"))
		return
	}

	role := row.Role
	if editorKey != nil && *editorKey != "" && *editorKey == a.Cfg.EditorKey {
		if role != auth.RoleEditor {
			if err := a.Store.UpdateUserRole(username, auth.RoleEditor); err != nil {
				writeError(w, r, err)
				return
			}
		}
		role = auth.RoleEditor
	}

	token, err := a.Tokens.Create(username, role)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, loginResponse{AccessToken: token, Role: role})
}

// Me — GET /api/auth/me.
func (a *API) Me(w http.ResponseWriter, r *http.Request) {
	u, err := a.currentUser(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}
