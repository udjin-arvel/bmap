// Package apperr — ошибки API в формате Okapi.
package apperr

import "fmt"

// Error соответствует HTTPException(detail={"detail": ..., "code": ...}).
// В ответе сериализуется как {"detail": {"detail": "...", "code": "..."}}.
type Error struct {
	Status int
	Code   string
	Detail string
}

func (e *Error) Error() string { return fmt.Sprintf("%d %s: %s", e.Status, e.Code, e.Detail) }

func New(status int, code, detail string) *Error {
	return &Error{Status: status, Code: code, Detail: detail}
}

// ValidationItem повторяет элемент ошибки валидации pydantic.
type ValidationItem struct {
	Type string `json:"type"`
	Loc  []any  `json:"loc"`
	Msg  string `json:"msg"`
}

// ValidationError — ответ 422 {"detail": [ ... ]}.
type ValidationError struct {
	Items []ValidationItem
}

func (e *ValidationError) Error() string {
	if len(e.Items) == 0 {
		return "validation error"
	}
	return "validation error: " + e.Items[0].Msg
}
