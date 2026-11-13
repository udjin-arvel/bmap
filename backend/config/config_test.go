package config

import (
	"bufio"
	"strings"
	"testing"
)

func TestParseDotEnv(t *testing.T) {
	m := parseDotEnv(bufio.NewScanner(strings.NewReader(`
# comment
NEO4J_URI=bolt://neo4j:7687
export jwt_secret="quoted # value"
EDITOR_KEY=abc # trailing
BROKEN
`)))
	if m["NEO4J_URI"] != "bolt://neo4j:7687" || m["JWT_SECRET"] != "quoted # value" || m["EDITOR_KEY"] != "abc" {
		t.Fatalf("%#v", m)
	}
	if _, ok := m["BROKEN"]; ok {
		t.Fatal("line without = parsed")
	}
}
