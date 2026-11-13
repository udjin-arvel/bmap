package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"

	"bmap-api/apperr"
	"bmap-api/graph"
)

const colorError = "Цвет не из палитры"

func (o *object) color(key string) (*string, bool) {
	c, present := o.optString(key, 0)
	if c != nil && !graph.ColorPalette[*c] {
		o.fail(key, "value_error", colorError)
	}
	return c, present
}

// parseNodeUpdate — NodeUpdate с exclude_unset: в Patch попадают только переданные поля.
func parseNodeUpdate(o *object) graph.Patch {
	p := graph.Patch{}
	if v, ok := o.optString("name", 1); ok {
		p["name"] = graph.StrOrNil(v)
	}
	if v, ok := o.optString("description", 0); ok {
		p["description"] = graph.StrOrNil(v)
	}
	if v, ok := o.color("color"); ok {
		p["color"] = graph.StrOrNil(v)
	}
	if v, ok := o.optString("note", 0); ok {
		p["note"] = graph.StrOrNil(v)
	}
	for _, k := range []string{"positionX", "positionY"} {
		if v, ok := o.optFloat(k); ok {
			if v == nil {
				p[k] = nil
			} else {
				p[k] = *v
			}
		}
	}
	if v, ok := o.optBool("descriptionPinned"); ok {
		if v == nil {
			p["descriptionPinned"] = nil
		} else {
			p["descriptionPinned"] = *v
		}
	}
	return p
}

// GraphRoots — GET /api/graph/roots.
func (a *API) GraphRoots(w http.ResponseWriter, r *http.Request) {
	roots, err := a.Graph.GetRoots(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, roots)
}

// GetGraph — GET /api/graph?focusId=.
func (a *API) GetGraph(w http.ResponseWriter, r *http.Request) {
	g, err := a.Graph.GetGraph(r.Context(), r.URL.Query().Get("focusId"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, g)
}

// GetNode — GET /api/nodes/{id}.
func (a *API) GetNode(w http.ResponseWriter, r *http.Request) {
	n, err := a.Graph.GetNode(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, n)
}

// CreateNode — POST /api/nodes (201, editor).
func (a *API) CreateNode(w http.ResponseWriter, r *http.Request) {
	o, err := parseBodyObject(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var body graph.NodeCreate
	body.ID, _ = o.optString("id", 0)
	body.Name = o.reqString("name", 1, 0)
	before := len(o.errs)
	body.NodeType = o.reqString("nodeType", 0, 0)
	if len(o.errs) == before { // строка получена — проверяем Literal
		o.literal("nodeType", body.NodeType, graph.NodeTypes)
	}
	body.Description, _ = o.optString("description", 0)
	body.Color, _ = o.color("color")
	body.Note, _ = o.optString("note", 0)
	body.PositionX = o.reqFloat("positionX")
	body.PositionY = o.reqFloat("positionY")
	body.DescriptionPinned, _ = o.optBool("descriptionPinned")
	if err := o.err(); err != nil {
		writeError(w, r, err)
		return
	}

	n, err := a.Graph.CreateNode(r.Context(), body)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, n)
}

// PatchNode — PATCH /api/nodes/{id} (204, editor).
func (a *API) PatchNode(w http.ResponseWriter, r *http.Request) {
	o, err := parseBodyObject(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	patch := parseNodeUpdate(o)
	if err := o.err(); err != nil {
		writeError(w, r, err)
		return
	}
	if err := a.Graph.UpdateNode(r.Context(), r.PathValue("id"), patch); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteNode — DELETE /api/nodes/{id} (204, editor).
func (a *API) DeleteNode(w http.ResponseWriter, r *http.Request) {
	if err := a.Graph.DeleteNode(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// BatchPatch — POST /api/nodes/batch-patch (204, editor). Тело — массив NodeUpdate с id.
func (a *API) BatchPatch(w http.ResponseWriter, r *http.Request) {
	raw, err := readBody(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if len(bytes.TrimSpace(raw)) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	items, err := parseBatch(raw)
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err := a.Graph.BatchPatch(r.Context(), items); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseBatch(raw []byte) ([]graph.BatchItem, error) {
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, apperr.New(http.StatusBadRequest, "UNKNOWN", "Некорректное тело JSON")
	}
	invalid := apperr.New(http.StatusBadRequest, "UNKNOWN", "Некорректный пакет изменений")
	var list []json.RawMessage
	if err := json.Unmarshal(raw, &list); err != nil || list == nil {
		return nil, invalid
	}
	items := make([]graph.BatchItem, 0, len(list))
	for i, el := range list {
		o, err := parseObject(el, []any{i})
		if err != nil {
			return nil, invalid
		}
		id := o.reqString("id", 0, 0)
		patch := parseNodeUpdate(o)
		if o.err() != nil {
			return nil, invalid
		}
		items = append(items, graph.BatchItem{ID: id, Patch: patch})
	}
	return items, nil
}

// CreateEdge — POST /api/edges (201, editor).
func (a *API) CreateEdge(w http.ResponseWriter, r *http.Request) {
	o, err := parseBodyObject(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	src := o.reqString("sourceId", 0, 0)
	tgt := o.reqString("targetId", 0, 0)
	if err := o.err(); err != nil {
		writeError(w, r, err)
		return
	}
	e, err := a.Graph.CreateEdge(r.Context(), src, tgt)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

// DeleteEdge — DELETE /api/edges/{id} (204, editor).
func (a *API) DeleteEdge(w http.ResponseWriter, r *http.Request) {
	if err := a.Graph.DeleteEdge(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
