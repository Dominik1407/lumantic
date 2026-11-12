package server

import (
	"strings"
	"testing"

	"github.com/Dominik1407/lumantic/internal/config"
)

// Open to others without a login, Lumantic shows only the examples: the look
// may change, own data, tokens and further Kosmen may not.
func TestOpenWithoutLoginOnlyExamples(t *testing.T) {
	e := newEnv(t, true, nil)
	e.srv.ExamplesOnly = true
	if code, out := e.do("GET", "/healthz", ""); code != 200 || out["ok"] != true {
		t.Fatalf("health: %d %v", code, out)
	}
	if code, out := e.do("PUT", "/api/settings", `{"ui":{"design":"stein"}}`); code != 200 {
		t.Fatalf("the look: %d %v", code, out)
	}
	for _, c := range []struct{ method, path, body string }{
		{"PUT", "/api/settings", `{"data":{"type":"files","path":"anderswo"}}`},
		{"PUT", "/api/settings", `{"ai":{"baseURL":"https://gateway.example"}}`},
		{"PUT", "/api/settings/secret", `{"key":"anthropicToken","value":"sk-ant-0000"}`},
		{"POST", "/api/settings/data/test", `{"data":{"type":"files","path":"C:/"}}`},
		{"POST", "/api/kosmen", `{"data":{"type":"files","name":"Mein","path":"eins"}}`},
	} {
		code, out := e.do(c.method, c.path, c.body)
		if code != 403 || !strings.Contains(out["error"].(string), "nur die Beispiele") {
			t.Errorf("%s %s %s: %d %v", c.method, c.path, c.body, code, out)
		}
	}
	if _, out := e.do("POST", "/api/kosmen", `{}`, "Accept-Language", "en"); !strings.HasPrefix(out["error"].(string), "Without a login") {
		t.Errorf("in English: %v", out)
	}
}

// An example that gets another source is the person's own from then on: no
// example any more, without the example's figures.
func TestOwnDataReplacesAnExample(t *testing.T) {
	e := newEnv(t, true, nil)
	c := e.srv.Config.File()
	c.Data.Example = true
	if err := e.srv.Config.Save(c); err != nil {
		t.Fatal(err)
	}
	if code, out := e.do("PUT", "/api/settings", `{"data":{"type":"duckdb","name":"Mein Goldlayer","path":"zwei"}}`); code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	f := e.srv.Config.File()
	if f.Data.Example || f.Metrics != "" || f.Data.Path != "zwei" {
		t.Fatalf("still an example: %+v %q", f.Data, f.Metrics)
	}
	renamed := config.Data{Name: "B", Example: true}
	if config.Adopt(config.Data{Name: "A", Example: true}, &renamed) || !renamed.Example {
		t.Fatal("a new name alone keeps an example")
	}
}
