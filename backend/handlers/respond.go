package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"bmap-api/apperr"
)

const maxBodyBytes = 4 << 20

func writeJSON(w http.ResponseWriter, status int, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		slog.Error("encode response", "err", err)
		http.Error(w, `{"detail":"Internal Server Error"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

// writeError отдаёт ошибку в формате FastAPI.
func writeError(w http.ResponseWriter, r *http.Request, err error) {
	var ae *apperr.Error
	var ve *apperr.ValidationError
	switch {
	case errors.As(err, &ae):
		writeJSON(w, ae.Status, map[string]any{"detail": map[string]string{"detail": ae.Detail, "code": ae.Code}})
	case errors.As(err, &ve):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"detail": ve.Items})
	default:
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"detail": "Internal Server Error"})
	}
}

func readBody(r *http.Request) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
}

// --- разбор JSON-объекта с ошибками в стиле pydantic ---

type object struct {
	m    map[string]json.RawMessage
	loc  []any
	errs []apperr.ValidationItem
}

// parseBodyObject читает тело как JSON-объект; при ошибке возвращает 422.
func parseBodyObject(r *http.Request) (*object, error) {
	raw, err := readBody(r)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, &apperr.ValidationError{Items: []apperr.ValidationItem{
			{Type: "missing", Loc: []any{"body"}, Msg: "Field required"},
		}}
	}
	return parseObject(raw, []any{"body"})
}

func parseObject(raw []byte, loc []any) (*object, error) {
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, &apperr.ValidationError{Items: []apperr.ValidationItem{
			{Type: "json_invalid", Loc: loc, Msg: "JSON decode error"},
		}}
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m == nil {
		return nil, &apperr.ValidationError{Items: []apperr.ValidationItem{
			{Type: "model_attributes_type", Loc: loc, Msg: "Input should be a valid dictionary or object to extract fields from"},
		}}
	}
	return &object{m: m, loc: loc}, nil
}

func (o *object) fail(key, typ, msg string) {
	loc := append(append([]any{}, o.loc...), key)
	o.errs = append(o.errs, apperr.ValidationItem{Type: typ, Loc: loc, Msg: msg})
}

func (o *object) err() error {
	if len(o.errs) == 0 {
		return nil
	}
	return &apperr.ValidationError{Items: o.errs}
}

// lookup: present — ключ есть; null — значение null.
func (o *object) lookup(key string) (raw json.RawMessage, present, null bool) {
	raw, present = o.m[key]
	if !present {
		return nil, false, false
	}
	return raw, true, bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}

func chars(n int) string {
	if n == 1 {
		return "character"
	}
	return "characters"
}

func (o *object) decodeString(key string, raw json.RawMessage, minLen, maxLen int) (string, bool) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		o.fail(key, "string_type", "Input should be a valid string")
		return "", false
	}
	n := utf8.RuneCountInString(s)
	if minLen > 0 && n < minLen {
		o.fail(key, "string_too_short", fmt.Sprintf("String should have at least %d %s", minLen, chars(minLen)))
		return "", false
	}
	if maxLen > 0 && n > maxLen {
		o.fail(key, "string_too_long", fmt.Sprintf("String should have at most %d %s", maxLen, chars(maxLen)))
		return "", false
	}
	return s, true
}

// reqString — обязательная строка (null недопустим).
func (o *object) reqString(key string, minLen, maxLen int) string {
	raw, present, null := o.lookup(key)
	if !present {
		o.fail(key, "missing", "Field required")
		return ""
	}
	if null {
		o.fail(key, "string_type", "Input should be a valid string")
		return ""
	}
	s, _ := o.decodeString(key, raw, minLen, maxLen)
	return s
}

// optString — str | None. Возвращает (значение или nil, ключ передан).
func (o *object) optString(key string, minLen int) (*string, bool) {
	raw, present, null := o.lookup(key)
	if !present {
		return nil, false
	}
	if null {
		return nil, true
	}
	s, ok := o.decodeString(key, raw, minLen, 0)
	if !ok {
		return nil, true
	}
	return &s, true
}

func (o *object) decodeFloat(key string, raw json.RawMessage) (float64, bool) {
	var f float64
	if err := json.Unmarshal(raw, &f); err != nil {
		o.fail(key, "float_type", "Input should be a valid number")
		return 0, false
	}
	return f, true
}

func (o *object) reqFloat(key string) float64 {
	raw, present, null := o.lookup(key)
	if !present {
		o.fail(key, "missing", "Field required")
		return 0
	}
	if null {
		o.fail(key, "float_type", "Input should be a valid number")
		return 0
	}
	f, _ := o.decodeFloat(key, raw)
	return f
}

func (o *object) optFloat(key string) (*float64, bool) {
	raw, present, null := o.lookup(key)
	if !present {
		return nil, false
	}
	if null {
		return nil, true
	}
	f, ok := o.decodeFloat(key, raw)
	if !ok {
		return nil, true
	}
	return &f, true
}

func (o *object) optBool(key string) (*bool, bool) {
	raw, present, null := o.lookup(key)
	if !present {
		return nil, false
	}
	if null {
		return nil, true
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err != nil {
		o.fail(key, "bool_type", "Input should be a valid boolean")
		return nil, true
	}
	return &b, true
}

// literal проверяет значение из перечня (Literal[...] в pydantic).
func (o *object) literal(key, val string, allowed []string) {
	for _, a := range allowed {
		if a == val {
			return
		}
	}
	quoted := make([]string, len(allowed))
	for i, a := range allowed {
		quoted[i] = "'" + a + "'"
	}
	msg := "Input should be " + strings.Join(quoted[:len(quoted)-1], ", ") + " or " + quoted[len(quoted)-1]
	o.fail(key, "literal_error", msg)
}
