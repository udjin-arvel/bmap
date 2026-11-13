// Package graph — карта рынка в Neo4j (аналог app/graph).
package graph

import (
	"fmt"
	"strings"

	"bmap-api/db"
)

var NodeTypes = []string{"PROCESS", "ACTOR", "RESOURCE", "LOGISTICS"}

var ColorPalette = map[string]bool{
	"#4A90D9": true, "#E67E22": true, "#27AE60": true,
	"#8E44AD": true, "#C0392B": true, "#7F8C8D": true,
}

func IsNodeType(s string) bool {
	for _, t := range NodeTypes {
		if t == s {
			return true
		}
	}
	return false
}

// Node — MarketNodeFull / MarketNodeListItem. Порядок полей как в pydantic-модели.
type Node struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	NodeType          string  `json:"nodeType"`
	Color             *string `json:"color"`
	Note              *string `json:"note"`
	PositionX         float64 `json:"positionX"`
	PositionY         float64 `json:"positionY"`
	DescriptionPinned bool    `json:"descriptionPinned"`
	HasDescription    bool    `json:"hasDescription"`
	IsBase            bool    `json:"isBase"`
	Origin            string  `json:"origin"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
	Description       *string `json:"description"`
}

type Edge struct {
	ID        string `json:"id"`
	SourceID  string `json:"sourceId"`
	TargetID  string `json:"targetId"`
	CreatedAt string `json:"createdAt"`
}

type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

type Root struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IsBase     bool   `json:"isBase"`
	ChildCount int64  `json:"childCount"`
}

// NodeCreate — тело POST /api/nodes.
type NodeCreate struct {
	ID                *string
	Name              string
	NodeType          string
	Description       *string
	Color             *string
	Note              *string
	PositionX         float64
	PositionY         float64
	DescriptionPinned *bool
}

// Patch — только переданные поля NodeUpdate (exclude_unset); nil означает явный null.
type Patch map[string]any

type BatchItem struct {
	ID    string
	Patch Patch
}

// nodeFromProps повторяет _props_to_node + _list_item/_full_node.
// full=false: описание отдаётся только для закреплённых (descriptionPinned) узлов.
func nodeFromProps(p map[string]any, full bool) Node {
	desc := optString(p["description"])
	pinned := truthy(p["descriptionPinned"])
	origin := str(p["origin"])
	if origin == "" {
		origin = "user"
	}
	created := str(p["createdAt"])
	if created == "" {
		created = db.NowISO()
	}
	updated := str(p["updatedAt"])
	if updated == "" {
		updated = db.NowISO()
	}
	n := Node{
		ID:                str(p["id"]),
		Name:              str(p["name"]),
		NodeType:          str(p["nodeType"]),
		Color:             optString(p["color"]),
		Note:              optString(p["note"]),
		PositionX:         toFloat(p["positionX"]),
		PositionY:         toFloat(p["positionY"]),
		DescriptionPinned: pinned,
		HasDescription:    desc != nil && strings.TrimSpace(*desc) != "",
		IsBase:            truthy(p["isBase"]),
		Origin:            origin,
		CreatedAt:         created,
		UpdatedAt:         updated,
	}
	if full || pinned {
		n.Description = desc
	}
	return n
}

func str(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	default:
		return fmt.Sprint(t)
	}
}

func optString(v any) *string {
	if v == nil {
		return nil
	}
	s := str(v)
	return &s
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case float32:
		return float64(t)
	case int64:
		return float64(t)
	case int:
		return float64(t)
	}
	return 0
}

// truthy — аналог bool(x) в Python.
func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case int64:
		return t != 0
	case float64:
		return t != 0
	}
	return true
}

// StrOrNil переводит *string в значение параметра Cypher.
func StrOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}
