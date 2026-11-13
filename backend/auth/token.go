// Package auth — выпуск и проверка JWT (аналог app/auth/security.py).
package auth

import (
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"bmap-api/apperr"
)

const (
	RoleViewer = "viewer"
	RoleEditor = "editor"
)

type User struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Tokens struct {
	Secret      []byte
	Algorithm   string
	ExpireHours int
}

func (t *Tokens) method() jwt.SigningMethod {
	if m := jwt.GetSigningMethod(t.Algorithm); m != nil {
		return m
	}
	return jwt.SigningMethodHS256
}

// Create выпускает токен с полями sub, role, exp (как PyJWT в Python-версии).
func (t *Tokens) Create(username, role string) (string, error) {
	claims := jwt.MapClaims{
		"sub":  username,
		"role": role,
		"exp":  time.Now().Add(time.Duration(t.ExpireHours) * time.Hour).Unix(),
	}
	return jwt.NewWithClaims(t.method(), claims).SignedString(t.Secret)
}

// Decode проверяет подпись и срок действия и возвращает пользователя из payload.
func (t *Tokens) Decode(raw string) (User, error) {
	m := t.method()
	tok, err := jwt.Parse(raw, func(*jwt.Token) (any, error) { return t.Secret, nil },
		jwt.WithValidMethods([]string{m.Alg()}))
	if err != nil || !tok.Valid {
		return User{}, apperr.New(http.StatusUnauthorized, "UNAUTHORIZED", "Токен недействителен или истёк")
	}
	claims, ok := tok.Claims.(jwt.MapClaims)
	if !ok {
		return User{}, errInvalidPayload
	}
	username, ok := claims["sub"].(string)
	role, _ := claims["role"].(string)
	if !ok || (role != RoleViewer && role != RoleEditor) {
		return User{}, errInvalidPayload
	}
	return User{Username: username, Role: role}, nil
}

var errInvalidPayload = apperr.New(http.StatusUnauthorized, "UNAUTHORIZED", "Некорректные данные токена")
