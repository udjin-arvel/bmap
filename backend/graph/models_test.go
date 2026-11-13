package graph

import "testing"

func TestNodeFromProps(t *testing.T) {
	p := map[string]any{
		"id": "n1", "name": "N", "nodeType": "PROCESS", "description": "  text ",
		"positionX": int64(3), "descriptionPinned": false, "isBase": true,
	}
	list := nodeFromProps(p, false)
	if list.Description != nil || !list.HasDescription || list.PositionX != 3 || list.Origin != "user" || !list.IsBase {
		t.Fatalf("list item %+v", list)
	}
	full := nodeFromProps(p, true)
	if full.Description == nil || *full.Description != "  text " {
		t.Fatalf("full %+v", full)
	}
	p["descriptionPinned"] = true
	p["description"] = "   "
	pinned := nodeFromProps(p, false)
	if pinned.Description == nil || pinned.HasDescription {
		t.Fatalf("pinned %+v", pinned)
	}
}
