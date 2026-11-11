package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/store"
)

// restart opens the config and the store of e again, the way a new process would.
func restart(t *testing.T, e *env) *Server {
	t.Helper()
	lookup := func(k string) (string, bool) { v, ok := e.vars[k]; return v, ok }
	cfg, err := config.Open(e.cfgPath, filepath.Join(e.dir, "data", "secrets.json"), lookup)
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(e.dir, "data", "board.json"), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{Store: st, Config: cfg, BuildSource: e.srv.BuildSource, NewLumina: e.srv.NewLumina}
	srv.Start(context.Background())
	return srv
}

func TestOneKosmosByDefault(t *testing.T) {
	e := newEnv(t, true, nil)
	code, out := e.do("GET", "/api/kosmen", "")
	list, _ := out["kosmen"].([]any)
	if code != 200 || len(list) != 1 {
		t.Fatalf("%d %v", code, out)
	}
	first := list[0].(map[string]any)
	if first["id"] != "main" || first["main"] != true || get(first, "status.ok") != true {
		t.Fatalf("first: %v", first)
	}
	_, s := e.do("GET", "/api/settings", "")
	if get(s, "kosmos.id") != "main" || get(s, "kosmos.main") != true || get(s, "kosmos.count").(float64) != 1 {
		t.Fatalf("kosmos in settings: %v", s["kosmos"])
	}
	if code, _ := e.do("GET", "/api/metrics?k=gibtsnicht", ""); code != 404 {
		t.Fatalf("unknown kosmos: %d", code)
	}
	if code, _ := e.do("DELETE", "/api/kosmen/main", ""); code != 409 {
		t.Fatalf("the first kosmos must stay: %d", code)
	}
}

func TestAddKosmosWithItsOwnFiguresAndPages(t *testing.T) {
	e := newEnv(t, true, map[string]string{"LUMANTIC_DUCKDB": "C:/tools/duckdb.exe"})
	before, _ := os.ReadFile(e.cfgPath)

	// A source that cannot be built or does not answer is not saved.
	for _, path := range []string{"kaputt", "offline"} {
		if code, out := e.do("POST", "/api/kosmen", `{"data":{"type":"duckdb","name":"Firmenkunden","path":"`+path+`"}}`); code != 422 {
			t.Fatalf("%s: %d %v", path, code, out)
		}
	}
	if code, _ := e.do("POST", "/api/kosmen", `{"data":{"type":"duckdb","name":"","path":"zwei"}}`); code != 422 {
		t.Fatalf("a kosmos needs a name: %d", code)
	}
	if after, _ := os.ReadFile(e.cfgPath); string(after) != string(before) {
		t.Fatalf("config changed by failed requests")
	}

	code, out := e.do("POST", "/api/kosmen", `{"data":{"type":"duckdb","name":"Firmenkunden","path":"zwei","duckdb":"C:/tools/duckdb.exe"}}`)
	if code != 201 || out["id"] != "firmenkunden" || out["name"] != "Firmenkunden" || out["main"] != false {
		t.Fatalf("add: %d %v", code, out)
	}
	// Connected, but nothing to show yet: the status says what is missing.
	if get(out, "status.ok") != false || get(out, "status.tables").(float64) != 1 || !strings.Contains(get(out, "status.error").(string), "noch keine Kennzahlen") {
		t.Fatalf("status of a new kosmos: %v", out["status"])
	}
	if code, _ := e.do("GET", "/api/metrics?k=firmenkunden", ""); code != 503 {
		t.Fatalf("metrics of a kosmos without figures: %d", code)
	}
	cfg, _ := os.ReadFile(e.cfgPath)
	if !strings.Contains(string(cfg), `"firmenkunden"`) || strings.Contains(string(cfg), "C:/tools") {
		t.Fatalf("config: the kosmos is missing or the shared DuckDB program was written down: %s", cfg)
	}
	// The same name again gets its own id.
	if code, out := e.do("POST", "/api/kosmen", `{"data":{"type":"duckdb","name":"Firmenkunden","path":"drei"}}`); code != 201 || out["id"] != "firmenkunden-2" {
		t.Fatalf("second: %d %v", code, out)
	}

	// Settings, catalog and key figures are the kosmos's own.
	_, s := e.do("GET", "/api/settings?k=firmenkunden", "")
	if get(s, "data.path") != "zwei" || get(s, "kosmos.id") != "firmenkunden" || get(s, "kosmos.count").(float64) != 3 || get(s, "data.duckdb") != "C:/tools/duckdb.exe" {
		t.Fatalf("settings: %v %v", s["data"], s["kosmos"])
	}
	locked, _ := s["locked"].([]any)
	if len(locked) != 1 || locked[0] != "data.duckdb" {
		t.Fatalf("locked for a further kosmos: %v", locked)
	}
	if _, k := e.do("GET", "/api/kpis?k=firmenkunden", ""); k["builtIn"] != false || len(k["kpis"].([]any)) != 0 {
		t.Fatalf("a new kosmos starts without figures: %v", k)
	}
	code, out = e.do("POST", "/api/kpis?k=firmenkunden", `{"name":"Kreditvolumen","unit":"Mio","kind":"stock","dir":1,"target":900,
		"group":"","groupName":"Kredite","monthly":{"table":"g.monat","value":"kredite"}}`)
	if code != 201 || out["status"] != "ok" {
		t.Fatalf("add figure: %d %v", code, out)
	}
	kp := filepath.Join(e.dir, "config", "kennzahlen-firmenkunden.json")
	if raw, err := os.ReadFile(kp); err != nil || !strings.Contains(string(raw), `"kreditvolumen"`) || strings.Contains(string(raw), `"lcr"`) {
		t.Fatalf("kennzahlen-firmenkunden.json: %v %s", err, raw)
	}
	if code, m := e.do("GET", "/api/metrics?k=firmenkunden", ""); code != 200 || len(m["kpis"].([]any)) != 1 || m["title"] != "Firmenkunden" {
		t.Fatalf("metrics: %d %v", code, m["title"])
	}
	if _, m := e.do("GET", "/api/metrics", ""); len(m["kpis"].([]any)) != 1 || m["title"] != "Test" {
		t.Fatalf("the first kosmos must be untouched: %v", m["title"])
	}

	// Pages are kept per kosmos; the first keeps its document.
	if code, _ := e.do("PUT", "/api/workspace?k=firmenkunden", `{"v":2,"kosmos":{"pages":["f"]}}`); code != 204 {
		t.Fatalf("put workspace: %d", code)
	}
	e.do("PUT", "/api/workspace", `{"v":2,"kosmos":{"pages":["m"]},"ui":{"design":"stein"}}`)
	if _, w := e.do("GET", "/api/workspace?k=firmenkunden", ""); get(w, "kosmos.pages").([]any)[0] != "f" {
		t.Fatalf("workspace of the kosmos: %v", w)
	}
	if _, w := e.do("GET", "/api/workspace", ""); get(w, "ui.design") != "stein" || get(w, "kosmos.pages").([]any)[0] != "m" {
		t.Fatalf("workspace of the first: %v", w)
	}

	// Another source for the kosmos: a failing one changes nothing, a working one is saved.
	if code, _ := e.do("PUT", "/api/settings?k=firmenkunden", `{"data":{"path":"offline"}}`); code != 422 {
		t.Fatalf("failing source: %d", code)
	}
	code, s = e.do("PUT", "/api/settings?k=firmenkunden", `{"data":{"path":"vier","name":"Firmen"}}`)
	if code != 200 || get(s, "data.path") != "vier" || get(s, "data.name") != "Firmen" || get(s, "status.ok") != true {
		t.Fatalf("new source: %d %v", code, s["status"])
	}
	if _, s := e.do("GET", "/api/settings", ""); get(s, "data.path") != "eins" {
		t.Fatalf("the first kosmos's source changed: %v", s["data"])
	}

	// Removing it takes its pages along and leaves the others.
	if code, _ := e.do("DELETE", "/api/kosmen/firmenkunden", ""); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := e.do("GET", "/api/metrics?k=firmenkunden", ""); code != 404 {
		t.Fatalf("after delete: %d", code)
	}
	if code, _ := e.do("DELETE", "/api/kosmen/firmenkunden", ""); code != 404 {
		t.Fatalf("delete again: %d", code)
	}
	_, out = e.do("GET", "/api/kosmen", "")
	if list := out["kosmen"].([]any); len(list) != 2 || list[1].(map[string]any)["id"] != "firmenkunden-2" {
		t.Fatalf("list after delete: %v", out)
	}
	board, _ := os.ReadFile(filepath.Join(e.dir, "data", "board.json"))
	if strings.Contains(string(board), `"firmenkunden"`) {
		t.Fatalf("the pages of the removed kosmos are still stored")
	}
}

func TestKosmenFromTheConfigFile(t *testing.T) {
	e := newEnv(t, true, nil)
	cfg, _ := os.ReadFile(e.cfgPath)
	mp := filepath.ToSlash(filepath.Join(e.dir, "kennzahlen-basis.json"))
	next := strings.Replace(string(cfg), `{"data":`, `{"kosmen":[{"id":"retail","data":{"type":"duckdb","name":"Retail","path":"zwei"},"metrics":"`+mp+`"},
		{"id":"weg","data":{"type":"duckdb","name":"Weg","path":"kaputt"}}],"data":`, 1)
	os.WriteFile(e.cfgPath, []byte(next), 0o644)
	e2 := &env{t: t, dir: e.dir, cfgPath: e.cfgPath}
	e2.srv = restart(t, e)
	e2.h = e2.srv.Routes()
	_, out := e2.do("GET", "/api/kosmen", "")
	list := out["kosmen"].([]any)
	if len(list) != 3 {
		t.Fatalf("kosmen: %v", out)
	}
	if retail := list[1].(map[string]any); retail["id"] != "retail" || get(retail, "status.ok") != true || get(retail, "status.kpisLoaded").(float64) != 1 {
		t.Fatalf("retail: %v", retail)
	}
	// A kosmos whose source fails still shows up, with its error.
	if weg := list[2].(map[string]any); get(weg, "status.ok") != false || !strings.Contains(get(weg, "status.error").(string), "kaputt") {
		t.Fatalf("weg: %v", weg)
	}
	if code, m := e2.do("GET", "/api/metrics?k=retail", ""); code != 200 || len(m["kpis"].([]any)) != 1 {
		t.Fatalf("metrics retail: %d", code)
	}
}
