package ai

import (
	"strings"
	"testing"

	"bmap-api/graph"
)

func TestParseSteps(t *testing.T) {
	anchor := graph.Node{Name: "Строительство"}

	steps, err := ParseSteps([]byte(`{"steps":[
		{"name":"Лес","nodeType":"RESOURCE","color":"#27AE60"},
		{"name":" строительство ","nodeType":"PROCESS"},
		{"name":"Продажа","nodeType":"ACTOR","description":"x","color":null}]}`), anchor)
	if err != nil {
		t.Fatal(err)
	}
	if !steps[1].Anchor || steps[0].Anchor || steps[2].Anchor {
		t.Fatalf("anchor by name not found: %+v", steps)
	}

	// явный anchor: берётся первый, остальные сбрасываются
	steps, err = ParseSteps([]byte(`{"steps":[
		{"name":"a","nodeType":"PROCESS","anchor":true},
		{"name":"b","nodeType":"PROCESS","anchor":true},
		{"name":"c","nodeType":"PROCESS"}]}`), anchor)
	if err != nil || !steps[0].Anchor || steps[1].Anchor {
		t.Fatalf("%v %+v", err, steps)
	}

	cases := map[string]string{
		`[]`:      "Некорректный ответ ИИ",
		`{"x":1}`: "steps: поле обязательно",
		`{"steps":[{"name":"a","nodeType":"PROCESS","anchor":true},{"name":"b","nodeType":"PROCESS"}]}`:                                                  "от 3 до 16",
		`{"steps":[{"name":"a","nodeType":"PROCESS"},{"name":"b","nodeType":"PROCESS"},{"name":"c","nodeType":"PROCESS"}]}`:                              "якорный шаг",
		`{"steps":[{"name":"a","nodeType":"BAD","anchor":true},{"name":"b","nodeType":"PROCESS"},{"name":"c","nodeType":"PROCESS"}]}`:                    "Некорректный тип узла",
		`{"steps":[{"name":"a","nodeType":"PROCESS","anchor":true,"color":"#fff"},{"name":"b","nodeType":"PROCESS"},{"name":"c","nodeType":"PROCESS"}]}`: "палитр",
		`{"steps":[{"name":"","nodeType":"PROCESS"}]}`: "хотя бы 1 символ",
	}
	for in, want := range cases {
		if _, err := ParseSteps([]byte(in), anchor); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v, want %q", in, err, want)
		}
	}
}

func TestAvoidOverlap(t *testing.T) {
	occ := []point{{0, 0}, {0, 120}}
	x, y := avoidOverlap(100, 0, &occ)
	if x != 100 || y != 240 {
		t.Fatalf("got %v,%v", x, y)
	}
	x, y = avoidOverlap(500, 0, &occ)
	if y != 0 || len(occ) != 4 {
		t.Fatalf("got %v,%v %d", x, y, len(occ))
	}
}
