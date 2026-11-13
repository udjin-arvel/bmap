package routes

import (
	"net/http/httptest"
	"testing"

	"bmap-api/handlers"
)

func TestRoutesRegisterAndProtect(t *testing.T) {
	mux := New(&handlers.API{})
	for _, c := range []struct{ m, p string }{
		{"POST", "/api/nodes"}, {"PATCH", "/api/nodes/x"}, {"DELETE", "/api/nodes/x"},
		{"POST", "/api/nodes/batch-patch"}, {"POST", "/api/edges"}, {"DELETE", "/api/edges/e"},
		{"POST", "/api/nodes/x/expand"}, {"GET", "/api/ai/jobs/j"}, {"GET", "/api/auth/me"},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(c.m, c.p, nil))
		if rec.Code != 401 {
			t.Errorf("%s %s -> %d", c.m, c.p, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/ws", nil))
	if rec.Code != 403 {
		t.Errorf("ws without token -> %d", rec.Code)
	}
}
