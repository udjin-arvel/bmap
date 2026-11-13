package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"bmap-api/apperr"
	"bmap-api/db"
	"bmap-api/graph"
)

const (
	stepX = 280.0
	stepY = 120.0
	// Максимальная длительность фоновой задачи (DeepSeek + запись в Neo4j).
	jobTimeout = 5 * time.Minute
)

type StepGenerator interface {
	GenerateExpandSteps(ctx context.Context, anchorName, anchorType string) ([]byte, error)
}

type Step struct {
	Name        string
	NodeType    string
	Description *string
	Color       *string
	Anchor      bool
}

type Expander struct {
	Graph *graph.Service
	Jobs  *JobStore
	Hub   *Hub
	AI    StepGenerator
}

// HasAIOutgoing — есть ли AI-узлы ниже или выше по цепочке NEXT_STEP.
func (e *Expander) HasAIOutgoing(ctx context.Context, nodeID string) (bool, error) {
	for _, q := range []string{
		`MATCH (n:MarketNode {id: $id})-[:NEXT_STEP*1..]->(d:MarketNode)
		 WHERE d.origin = 'ai'
		 RETURN count(d) > 0 AS v`,
		`MATCH (u:MarketNode {origin: 'ai'})-[:NEXT_STEP*1..]->(n:MarketNode {id: $id})
		 RETURN count(u) > 0 AS v`,
	} {
		recs, err := e.Graph.Run(ctx, q, map[string]any{"id": nodeID})
		if err != nil {
			return false, err
		}
		if len(recs) > 0 && graph.RecBool(recs[0], "v") {
			return true, nil
		}
	}
	return false, nil
}

func (e *Expander) removeAIChainsAround(ctx context.Context, anchorID string) error {
	for _, q := range []string{
		`MATCH (anchor:MarketNode {id: $id})
		 OPTIONAL MATCH (anchor)-[:NEXT_STEP*]->(down:MarketNode {origin: 'ai'})
		 DETACH DELETE down`,
		`MATCH (anchor:MarketNode {id: $id})
		 OPTIONAL MATCH (up:MarketNode {origin: 'ai'})-[:NEXT_STEP*]->(anchor)
		 DETACH DELETE up`,
	} {
		if _, err := e.Graph.Run(ctx, q, map[string]any{"id": anchorID}); err != nil {
			return err
		}
	}
	return nil
}

func invalidAI(msg string) error {
	return apperr.New(http.StatusBadRequest, "UNKNOWN", "Некорректный ответ ИИ: "+msg)
}

// ParseSteps валидирует ответ модели (ExpandStepsPayload + _parse_steps).
func ParseSteps(content []byte, anchor graph.Node) ([]Step, error) {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(content, &payload); err != nil {
		return nil, invalidAI("ответ должен быть JSON-объектом")
	}
	rawSteps, ok := payload["steps"]
	if !ok {
		return nil, invalidAI("steps: поле обязательно")
	}
	var items []json.RawMessage
	if err := json.Unmarshal(rawSteps, &items); err != nil {
		return nil, invalidAI("steps: ожидается список")
	}

	steps := make([]Step, 0, len(items))
	for i, it := range items {
		var rs struct {
			Name        *string `json:"name"`
			NodeType    *string `json:"nodeType"`
			Description *string `json:"description"`
			Color       *string `json:"color"`
			Anchor      *bool   `json:"anchor"`
		}
		if err := json.Unmarshal(it, &rs); err != nil {
			return nil, invalidAI(fmt.Sprintf("steps.%d: %v", i, err))
		}
		if rs.Name == nil || *rs.Name == "" {
			return nil, invalidAI(fmt.Sprintf("steps.%d.name: строка должна содержать хотя бы 1 символ", i))
		}
		if rs.NodeType == nil {
			return nil, invalidAI(fmt.Sprintf("steps.%d.nodeType: поле обязательно", i))
		}
		steps = append(steps, Step{
			Name:        *rs.Name,
			NodeType:    *rs.NodeType,
			Description: rs.Description,
			Color:       rs.Color,
			Anchor:      rs.Anchor != nil && *rs.Anchor,
		})
	}

	if len(steps) < 3 || len(steps) > 16 {
		return nil, apperr.New(http.StatusBadRequest, "UNKNOWN", "ИИ должен вернуть от 3 до 16 шагов")
	}

	anchorIdx := -1
	for i, s := range steps {
		if s.Anchor {
			anchorIdx = i
			break
		}
	}
	if anchorIdx < 0 {
		want := strings.ToLower(strings.TrimSpace(anchor.Name))
		for i, s := range steps {
			if strings.ToLower(strings.TrimSpace(s.Name)) == want {
				anchorIdx = i
				break
			}
		}
	}
	if anchorIdx < 0 {
		return nil, apperr.New(http.StatusBadRequest, "UNKNOWN", "В ответе ИИ должен быть отмечен якорный шаг")
	}

	for i := range steps {
		if !graph.IsNodeType(steps[i].NodeType) {
			return nil, apperr.New(http.StatusBadRequest, "UNKNOWN", "Некорректный тип узла: "+steps[i].NodeType)
		}
		if c := steps[i].Color; c != nil && !graph.ColorPalette[*c] {
			return nil, apperr.New(http.StatusBadRequest, "INVALID_COLOR", "Цвет не из палитры")
		}
		steps[i].Anchor = i == anchorIdx
	}
	return steps, nil
}

type point struct{ x, y float64 }

func (e *Expander) occupiedPositions(ctx context.Context) ([]point, error) {
	recs, err := e.Graph.Run(ctx, "MATCH (n:MarketNode) RETURN n.positionX AS x, n.positionY AS y", nil)
	if err != nil {
		return nil, err
	}
	pts := make([]point, 0, len(recs))
	for _, r := range recs {
		pts = append(pts, point{graph.RecFloat(r, "x"), graph.RecFloat(r, "y")})
	}
	return pts, nil
}

// avoidOverlap сдвигает точку вниз, пока она пересекается с занятыми, и занимает её.
func avoidOverlap(x, y float64, occupied *[]point) (float64, float64) {
	for {
		hit := false
		for _, p := range *occupied {
			if math.Abs(x-p.x) < 200 && math.Abs(y-p.y) < 80 {
				hit = true
				break
			}
		}
		if !hit {
			break
		}
		y += stepY
	}
	*occupied = append(*occupied, point{x, y})
	return x, y
}

func (e *Expander) applyExpandSteps(ctx context.Context, anchorID string, steps []Step) ([]graph.Node, []graph.Edge, error) {
	anchor, err := e.Graph.GetNode(ctx, anchorID)
	if err != nil {
		return nil, nil, err
	}
	anchorIdx := 0
	for i, s := range steps {
		if s.Anchor {
			anchorIdx = i
			break
		}
	}
	occupied, err := e.occupiedPositions(ctx)
	if err != nil {
		return nil, nil, err
	}
	now := db.NowISO()

	nodeIDs := make([]string, 0, len(steps))
	newNodes := []graph.Node{}
	newProps := []map[string]any{}

	for i, step := range steps {
		if step.Anchor {
			nodeIDs = append(nodeIDs, anchorID)
			continue
		}
		x := anchor.PositionX + float64(i-anchorIdx)*stepX
		x, y := avoidOverlap(x, anchor.PositionY, &occupied)
		props := map[string]any{
			"id":                uuid.NewString(),
			"name":              strings.TrimSpace(step.Name),
			"nodeType":          step.NodeType,
			"description":       graph.StrOrNil(step.Description),
			"color":             graph.StrOrNil(step.Color),
			"note":              nil,
			"positionX":         x,
			"positionY":         y,
			"descriptionPinned": false,
			"isBase":            false,
			"origin":            "ai",
			"createdAt":         now,
			"updatedAt":         now,
		}
		nodeIDs = append(nodeIDs, props["id"].(string))
		newProps = append(newProps, props)
		newNodes = append(newNodes, graph.FullNode(props))
	}

	for _, p := range newProps {
		if _, err := e.Graph.Run(ctx, "CREATE (node:MarketNode) SET node = $props", map[string]any{"props": p}); err != nil {
			return nil, nil, err
		}
	}

	newEdges := []graph.Edge{}
	for i := 0; i+1 < len(nodeIDs); i++ {
		src, tgt := nodeIDs[i], nodeIDs[i+1]
		cycle, err := e.Graph.WouldCreateCycle(ctx, src, tgt)
		if err != nil {
			return nil, nil, err
		}
		if cycle {
			return nil, nil, apperr.New(http.StatusBadRequest, "CYCLE_DETECTED", "Цепочка ИИ создаст цикл")
		}
		edge, err := e.Graph.InsertEdge(ctx, src, tgt, now)
		if err != nil {
			return nil, nil, err
		}
		newEdges = append(newEdges, edge)
	}
	return newNodes, newEdges, nil
}

func (e *Expander) broadcastStatus(jobID, nodeID, status, message string) {
	msg := map[string]any{"type": "ai.status", "jobId": jobID, "nodeId": nodeID, "status": status}
	if message != "" {
		msg["message"] = message
	}
	e.Hub.Broadcast(msg)
}

func (e *Expander) runExpandJob(jobID, anchorID string, force bool) {
	ctx, cancel := context.WithTimeout(context.Background(), jobTimeout)
	defer cancel()

	e.Jobs.update(jobID, func(j *JobOut) { j.Status = StatusRunning })
	e.broadcastStatus(jobID, anchorID, StatusRunning, "")

	nodes, edges, err := e.expand(ctx, anchorID, force)
	if err != nil {
		msg := err.Error()
		var ae *apperr.Error
		if errors.As(err, &ae) {
			msg = ae.Detail
		}
		slog.Warn("ai expand failed", "job", jobID, "node", anchorID, "err", err)
		e.Jobs.update(jobID, func(j *JobOut) { j.Status = StatusError; j.Error = &msg })
		e.broadcastStatus(jobID, anchorID, StatusError, msg)
		return
	}

	e.Jobs.update(jobID, func(j *JobOut) {
		j.Status = StatusCompleted
		j.Nodes = nodes
		j.Edges = edges
	})
	e.Hub.Broadcast(map[string]any{
		"type":   "graph.patch",
		"jobId":  jobID,
		"nodeId": anchorID,
		"nodes":  nodes,
		"edges":  edges,
	})
	e.broadcastStatus(jobID, anchorID, StatusCompleted, "")
}

func (e *Expander) expand(ctx context.Context, anchorID string, force bool) ([]graph.Node, []graph.Edge, error) {
	anchor, err := e.Graph.GetNode(ctx, anchorID)
	if err != nil {
		return nil, nil, err
	}
	if force {
		if err := e.removeAIChainsAround(ctx, anchorID); err != nil {
			return nil, nil, err
		}
	}
	content, err := e.AI.GenerateExpandSteps(ctx, anchor.Name, anchor.NodeType)
	if err != nil {
		return nil, nil, err
	}
	steps, err := ParseSteps(content, anchor)
	if err != nil {
		return nil, nil, err
	}
	return e.applyExpandSteps(ctx, anchorID, steps)
}

// StartExpand проверяет узел, создаёт задачу и запускает её в фоне.
func (e *Expander) StartExpand(ctx context.Context, anchorID string, force bool) (string, error) {
	if _, err := e.Graph.GetNode(ctx, anchorID); err != nil {
		return "", err
	}
	if !force {
		has, err := e.HasAIOutgoing(ctx, anchorID)
		if err != nil {
			return "", err
		}
		if has {
			return "", apperr.New(http.StatusConflict, "AI_CHAIN_EXISTS", "У узла уже есть AI-продолжение — подтвердите замену")
		}
	}
	jobID := e.Jobs.Create(anchorID)
	go e.runExpandJob(jobID, anchorID, force)
	return jobID, nil
}
