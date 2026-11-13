package graph

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"bmap-api/apperr"
	"bmap-api/db"
)

var errNodeNotFound = apperr.New(http.StatusNotFound, "NODE_NOT_FOUND", "Узел не найден")

type Service struct {
	Driver neo4j.DriverWithContext
	Store  *db.Store
}

func NewService(driver neo4j.DriverWithContext, store *db.Store) *Service {
	return &Service{Driver: driver, Store: store}
}

// Run выполняет запрос в авто-транзакции и возвращает все записи.
func (s *Service) Run(ctx context.Context, query string, params map[string]any) ([]*neo4j.Record, error) {
	res, err := neo4j.ExecuteQuery(ctx, s.Driver, query, params, neo4j.EagerResultTransformer)
	if err != nil {
		return nil, err
	}
	return res.Records, nil
}

// --- helpers для чтения записей ---

func RecStr(r *neo4j.Record, key string) string {
	v, _ := r.Get(key)
	return str(v)
}

func RecBool(r *neo4j.Record, key string) bool {
	v, _ := r.Get(key)
	return truthy(v)
}

func RecInt(r *neo4j.Record, key string) int64 {
	v, _ := r.Get(key)
	n, _ := v.(int64)
	return n
}

func RecFloat(r *neo4j.Record, key string) float64 {
	v, _ := r.Get(key)
	return toFloat(v)
}

func recProps(r *neo4j.Record, key string) map[string]any {
	v, _ := r.Get(key)
	out := map[string]any{}
	if n, ok := v.(neo4j.Node); ok {
		for k, val := range n.Props {
			out[k] = val
		}
	}
	return out
}

func recStrings(r *neo4j.Record, key string) []string {
	v, _ := r.Get(key)
	list, _ := v.([]any)
	out := make([]string, 0, len(list))
	for _, x := range list {
		if s, ok := x.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// FullNode строит полный узел (с описанием) из свойств.
func FullNode(props map[string]any) Node { return nodeFromProps(props, true) }

// --- схема и сиды ---

func (s *Service) EnsureSchema(ctx context.Context) error {
	stmts := []string{
		"CREATE CONSTRAINT market_node_id IF NOT EXISTS FOR (n:MarketNode) REQUIRE n.id IS UNIQUE",
		"CREATE INDEX market_node_name IF NOT EXISTS FOR (n:MarketNode) ON (n.name)",
		"CREATE INDEX market_node_type IF NOT EXISTS FOR (n:MarketNode) ON (n.nodeType)",
	}
	for _, q := range stmts {
		if _, err := s.Run(ctx, q, nil); err != nil {
			return err
		}
	}
	return nil
}

type seedEntry struct {
	ID                string   `json:"id"`
	Name              string   `json:"name"`
	NodeType          string   `json:"nodeType"`
	Description       *string  `json:"description"`
	Color             *string  `json:"color"`
	PositionX         *float64 `json:"positionX"`
	PositionY         *float64 `json:"positionY"`
	DescriptionPinned bool     `json:"descriptionPinned"`
}

// ApplyBaseSeeds создаёт базовые узлы, которые ещё не отмечены в applied_seeds.
func (s *Service) ApplyBaseSeeds(ctx context.Context, data []byte) error {
	if len(data) == 0 {
		return nil
	}
	var seeds []seedEntry
	if err := json.Unmarshal(data, &seeds); err != nil {
		return err
	}
	for _, e := range seeds {
		applied, err := s.Store.IsSeedApplied(e.ID)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		now := db.NowISO()
		var x, y float64
		if e.PositionX != nil {
			x = *e.PositionX
		}
		if e.PositionY != nil {
			y = *e.PositionY
		}
		props := map[string]any{
			"id":                e.ID,
			"name":              e.Name,
			"nodeType":          e.NodeType,
			"description":       StrOrNil(e.Description),
			"color":             StrOrNil(e.Color),
			"note":              nil,
			"positionX":         x,
			"positionY":         y,
			"descriptionPinned": e.DescriptionPinned,
			"isBase":            true,
			"origin":            "base",
			"createdAt":         now,
			"updatedAt":         now,
		}
		if _, err := s.Run(ctx, "MERGE (n:MarketNode {id: $id}) ON CREATE SET n = $props",
			map[string]any{"id": e.ID, "props": props}); err != nil {
			return err
		}
		if err := s.Store.MarkSeedApplied(e.ID); err != nil {
			return err
		}
	}
	return nil
}

// --- чтение ---

func (s *Service) nodeIDsForFocus(ctx context.Context, focusID string) (map[string]bool, error) {
	recs, err := s.Run(ctx, "MATCH (f:MarketNode {id: $id}) RETURN f.id AS id LIMIT 1", map[string]any{"id": focusID})
	if err != nil {
		return nil, err
	}
	if len(recs) == 0 {
		return nil, errNodeNotFound
	}
	ids := map[string]bool{}
	for _, q := range []string{
		`MATCH (f:MarketNode {id: $id})
		 MATCH (f)-[:NEXT_STEP*0..]->(n:MarketNode)
		 RETURN collect(DISTINCT n.id) AS ids`,
		`MATCH (f:MarketNode {id: $id})
		 MATCH (n:MarketNode)-[:NEXT_STEP*0..]->(f)
		 RETURN collect(DISTINCT n.id) AS ids`,
	} {
		recs, err := s.Run(ctx, q, map[string]any{"id": focusID})
		if err != nil {
			return nil, err
		}
		if len(recs) > 0 {
			for _, id := range recStrings(recs[0], "ids") {
				ids[id] = true
			}
		}
	}
	return ids, nil
}

func (s *Service) GetGraph(ctx context.Context, focusID string) (Graph, error) {
	var allowed map[string]bool
	if focusID != "" {
		var err error
		if allowed, err = s.nodeIDsForFocus(ctx, focusID); err != nil {
			return Graph{}, err
		}
	}

	out := Graph{Nodes: []Node{}, Edges: []Edge{}}

	nodeRecs, err := s.Run(ctx, "MATCH (n:MarketNode) RETURN n", nil)
	if err != nil {
		return Graph{}, err
	}
	for _, r := range nodeRecs {
		props := recProps(r, "n")
		if allowed != nil && !allowed[str(props["id"])] {
			continue
		}
		out.Nodes = append(out.Nodes, nodeFromProps(props, false))
	}

	edgeRecs, err := s.Run(ctx, `
		MATCH (s:MarketNode)-[r:NEXT_STEP]->(t:MarketNode)
		RETURN r.id AS id, s.id AS sourceId, t.id AS targetId, r.createdAt AS createdAt`, nil)
	if err != nil {
		return Graph{}, err
	}
	for _, r := range edgeRecs {
		e := Edge{
			ID:        RecStr(r, "id"),
			SourceID:  RecStr(r, "sourceId"),
			TargetID:  RecStr(r, "targetId"),
			CreatedAt: RecStr(r, "createdAt"),
		}
		if allowed != nil && (!allowed[e.SourceID] || !allowed[e.TargetID]) {
			continue
		}
		out.Edges = append(out.Edges, e)
	}
	return out, nil
}

func (s *Service) GetRoots(ctx context.Context) ([]Root, error) {
	recs, err := s.Run(ctx, `
		MATCH (n:MarketNode)
		WHERE coalesce(n.isBase, false) = true
		   OR NOT EXISTS { ()-[:NEXT_STEP]->(n) }
		OPTIONAL MATCH (n)-[:NEXT_STEP]->(c:MarketNode)
		WITH n, count(c) AS childCount
		RETURN n.id AS id, n.name AS name, coalesce(n.isBase, false) AS isBase, childCount
		ORDER BY n.name`, nil)
	if err != nil {
		return nil, err
	}
	roots := make([]Root, 0, len(recs))
	for _, r := range recs {
		roots = append(roots, Root{
			ID:         RecStr(r, "id"),
			Name:       RecStr(r, "name"),
			IsBase:     RecBool(r, "isBase"),
			ChildCount: RecInt(r, "childCount"),
		})
	}
	return roots, nil
}

func (s *Service) getProps(ctx context.Context, id string) (map[string]any, bool, error) {
	recs, err := s.Run(ctx, "MATCH (n:MarketNode {id: $id}) RETURN n LIMIT 1", map[string]any{"id": id})
	if err != nil {
		return nil, false, err
	}
	if len(recs) == 0 {
		return nil, false, nil
	}
	return recProps(recs[0], "n"), true, nil
}

func (s *Service) GetNode(ctx context.Context, id string) (Node, error) {
	props, ok, err := s.getProps(ctx, id)
	if err != nil {
		return Node{}, err
	}
	if !ok {
		return Node{}, errNodeNotFound
	}
	return FullNode(props), nil
}

// --- запись ---

func (s *Service) CreateNode(ctx context.Context, body NodeCreate) (Node, error) {
	id := ""
	if body.ID != nil {
		id = *body.ID
	}
	if id == "" {
		id = uuid.NewString()
	}
	now := db.NowISO()
	pinned := body.DescriptionPinned != nil && *body.DescriptionPinned

	props := map[string]any{
		"id":                id,
		"name":              strings.TrimSpace(body.Name),
		"nodeType":          body.NodeType,
		"description":       StrOrNil(body.Description),
		"color":             StrOrNil(body.Color),
		"note":              StrOrNil(body.Note),
		"positionX":         body.PositionX,
		"positionY":         body.PositionY,
		"descriptionPinned": pinned,
		"isBase":            false,
		"origin":            "user",
		"createdAt":         now,
		"updatedAt":         now,
	}

	_, exists, err := s.getProps(ctx, id)
	if err != nil {
		return Node{}, err
	}
	if exists {
		return Node{}, apperr.New(http.StatusBadRequest, "UNKNOWN", "Узел с таким id уже есть")
	}
	if _, err := s.Run(ctx, "CREATE (n:MarketNode) SET n = $props", map[string]any{"props": props}); err != nil {
		return Node{}, err
	}
	return FullNode(props), nil
}

func (s *Service) applyPatch(ctx context.Context, id string, props map[string]any, patch Patch) error {
	for k, v := range patch {
		props[k] = v
	}
	props["updatedAt"] = db.NowISO()
	_, err := s.Run(ctx, "MATCH (n:MarketNode {id: $id}) SET n = $props", map[string]any{"id": id, "props": props})
	return err
}

func (s *Service) UpdateNode(ctx context.Context, id string, patch Patch) error {
	if len(patch) == 0 {
		return nil
	}
	props, ok, err := s.getProps(ctx, id)
	if err != nil {
		return err
	}
	if !ok {
		return errNodeNotFound
	}
	return s.applyPatch(ctx, id, props, patch)
}

func (s *Service) DeleteNode(ctx context.Context, id string) error {
	recs, err := s.Run(ctx, "MATCH (n:MarketNode {id: $id}) DETACH DELETE n RETURN count(n) AS c", map[string]any{"id": id})
	if err != nil {
		return err
	}
	if len(recs) == 0 || RecInt(recs[0], "c") == 0 {
		return errNodeNotFound
	}
	return nil
}

func (s *Service) BatchPatch(ctx context.Context, items []BatchItem) error {
	for _, it := range items {
		if len(it.Patch) == 0 {
			continue
		}
		props, ok, err := s.getProps(ctx, it.ID)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		if err := s.applyPatch(ctx, it.ID, props, it.Patch); err != nil {
			return err
		}
	}
	return nil
}

// WouldCreateCycle — есть ли путь target -> ... -> source.
func (s *Service) WouldCreateCycle(ctx context.Context, sourceID, targetID string) (bool, error) {
	recs, err := s.Run(ctx, `
		MATCH (target:MarketNode {id: $targetId})
		MATCH (target)-[:NEXT_STEP*]->(source:MarketNode {id: $sourceId})
		RETURN count(source) > 0 AS cycle`,
		map[string]any{"sourceId": sourceID, "targetId": targetID})
	if err != nil {
		return false, err
	}
	return len(recs) > 0 && RecBool(recs[0], "cycle"), nil
}

// InsertEdge создаёт связь NEXT_STEP без проверок.
func (s *Service) InsertEdge(ctx context.Context, sourceID, targetID, createdAt string) (Edge, error) {
	id := uuid.NewString()
	_, err := s.Run(ctx, `
		MATCH (s:MarketNode {id: $sourceId})
		MATCH (t:MarketNode {id: $targetId})
		CREATE (s)-[r:NEXT_STEP {id: $edgeId, createdAt: $createdAt}]->(t)`,
		map[string]any{"sourceId": sourceID, "targetId": targetID, "edgeId": id, "createdAt": createdAt})
	if err != nil {
		return Edge{}, err
	}
	return Edge{ID: id, SourceID: sourceID, TargetID: targetID, CreatedAt: createdAt}, nil
}

func (s *Service) CreateEdge(ctx context.Context, sourceID, targetID string) (Edge, error) {
	if sourceID == targetID {
		return Edge{}, apperr.New(http.StatusBadRequest, "SELF_CONNECTION", "Нельзя соединить узел с самим собой")
	}
	params := map[string]any{"sourceId": sourceID, "targetId": targetID}

	recs, err := s.Run(ctx, `
		MATCH (s:MarketNode {id: $sourceId})
		MATCH (t:MarketNode {id: $targetId})
		RETURN s, t`, params)
	if err != nil {
		return Edge{}, err
	}
	if len(recs) == 0 {
		return Edge{}, errNodeNotFound
	}

	recs, err = s.Run(ctx, `
		MATCH (s:MarketNode {id: $sourceId})-[r:NEXT_STEP]->(t:MarketNode {id: $targetId})
		RETURN r LIMIT 1`, params)
	if err != nil {
		return Edge{}, err
	}
	if len(recs) > 0 {
		return Edge{}, apperr.New(http.StatusBadRequest, "DUPLICATE_EDGE", "Такая связь уже существует")
	}

	cycle, err := s.WouldCreateCycle(ctx, sourceID, targetID)
	if err != nil {
		return Edge{}, err
	}
	if cycle {
		return Edge{}, apperr.New(http.StatusBadRequest, "CYCLE_DETECTED", "Связь создаст цикл")
	}
	return s.InsertEdge(ctx, sourceID, targetID, db.NowISO())
}

func (s *Service) DeleteEdge(ctx context.Context, id string) error {
	recs, err := s.Run(ctx, "MATCH ()-[r:NEXT_STEP {id: $id}]->() DELETE r RETURN count(r) AS c", map[string]any{"id": id})
	if err != nil {
		return err
	}
	if len(recs) == 0 || RecInt(recs[0], "c") == 0 {
		return apperr.New(http.StatusNotFound, "NODE_NOT_FOUND", "Связь не найдена")
	}
	return nil
}
