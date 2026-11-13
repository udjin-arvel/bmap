package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"bmap-api/graph"
)

func do(h http.Handler, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func testMux(a *API) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/nodes", a.EditorOnly(a.CreateNode))
	mux.HandleFunc("POST /api/nodes/raw", a.CreateNode)
	mux.HandleFunc("POST /api/auth/register", a.Register)
	mux.HandleFunc("/", NotFound)
	return mux
}

func TestEditorOnlyWithoutToken(t *testing.T) {
	rec := do(testMux(&API{}), "POST", "/api/nodes", `{}`, nil)
	if rec.Code != 401 {
		t.Fatalf("code %d", rec.Code)
	}
	want := `{"detail":{"code":"UNAUTHORIZED","detail":"Требуется авторизация"}}`
	if strings.TrimSpace(rec.Body.String()) != want {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestCreateNodeValidation(t *testing.T) {
	rec := do(testMux(&API{}), "POST", "/api/nodes/raw",
		`{"name":"","nodeType":"FOO","positionX":"x","color":"#000000"}`, nil)
	if rec.Code != 422 {
		t.Fatalf("code %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Detail []struct {
			Type string `json:"type"`
			Loc  []any  `json:"loc"`
			Msg  string `json:"msg"`
		} `json:"detail"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	types := map[string]string{}
	for _, d := range body.Detail {
		types[d.Loc[1].(string)] = d.Type + ": " + d.Msg
	}
	for field, want := range map[string]string{
		"name":      "string_too_short",
		"nodeType":  "literal_error: Допустимые значения: 'PROCESS', 'ACTOR', 'RESOURCE' или 'LOGISTICS'",
		"positionX": "float_type",
		"positionY": "missing",
		"color":     "value_error: Цвет не из палитры",
	} {
		if !strings.HasPrefix(types[field], want) {
			t.Errorf("%s: got %q want prefix %q", field, types[field], want)
		}
	}
}

func TestBodyErrors(t *testing.T) {
	mux := testMux(&API{})
	if rec := do(mux, "POST", "/api/auth/register", ``, nil); rec.Code != 422 || !strings.Contains(rec.Body.String(), `"missing"`) {
		t.Fatalf("empty: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(mux, "POST", "/api/auth/register", `{bad`, nil); rec.Code != 422 || !strings.Contains(rec.Body.String(), "json_invalid") {
		t.Fatalf("bad json: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(mux, "POST", "/api/auth/register", `{"username":"ab","password":"123"}`, nil); rec.Code != 422 || !strings.Contains(rec.Body.String(), "не меньше 4 символов") {
		t.Fatalf("short pw: %d %s", rec.Code, rec.Body.String())
	}
	if rec := do(mux, "GET", "/nope", ``, nil); rec.Code != 404 || strings.TrimSpace(rec.Body.String()) != `{"detail":"Не найдено"}` {
		t.Fatalf("404: %d %s", rec.Code, rec.Body.String())
	}
}

func TestParseNodeUpdateExcludeUnset(t *testing.T) {
	o, err := parseObject([]byte(`{"name":"A","note":null,"positionX":5,"extra":1}`), []any{"body"})
	if err != nil {
		t.Fatal(err)
	}
	p := parseNodeUpdate(o)
	if o.err() != nil {
		t.Fatal(o.err())
	}
	if len(p) != 3 || p["name"] != "A" || p["positionX"] != 5.0 {
		t.Fatalf("patch %#v", p)
	}
	if v, ok := p["note"]; !ok || v != nil {
		t.Fatalf("note must be explicit null: %#v", p)
	}
}

func TestParseBatch(t *testing.T) {
	items, err := parseBatch([]byte(`[{"id":"a","positionX":1,"positionY":2},{"id":"b"}]`))
	if err != nil || len(items) != 2 || items[0].ID != "a" || len(items[1].Patch) != 0 {
		t.Fatalf("%v %#v", err, items)
	}
	if _, err := parseBatch([]byte(`[{"positionX":1}]`)); err == nil || !strings.Contains(err.Error(), "Некорректный пакет изменений") {
		t.Fatalf("missing id: %v", err)
	}
	if _, err := parseBatch([]byte(`[{"id":"a","color":"red"}]`)); err == nil {
		t.Fatal("bad color accepted")
	}
	if _, err := parseBatch([]byte(`{`)); err == nil || !strings.Contains(err.Error(), "Некорректное тело JSON") {
		t.Fatalf("bad json: %v", err)
	}
	_ = graph.Patch{}
}

func TestCORS(t *testing.T) {
	h := CORS([]string{"http://localhost:5173"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(204)
	}))
	rec := do(h, "OPTIONS", "/api/nodes", "", map[string]string{
		"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PATCH",
		"Access-Control-Request-Headers": "authorization,content-type",
	})
	if rec.Code != 200 || rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" ||
		rec.Header().Get("Access-Control-Allow-Headers") != "authorization,content-type" ||
		rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("preflight %d %v", rec.Code, rec.Header())
	}
	rec = do(h, "OPTIONS", "/api/nodes", "", map[string]string{"Origin": "http://evil", "Access-Control-Request-Method": "GET"})
	if rec.Code != 400 {
		t.Fatalf("disallowed preflight %d", rec.Code)
	}
	rec = do(h, "GET", "/api/graph", "", map[string]string{"Origin": "http://localhost:5173"})
	if rec.Code != 204 || rec.Header().Get("Access-Control-Allow-Origin") == "" {
		t.Fatalf("simple %d %v", rec.Code, rec.Header())
	}
}
