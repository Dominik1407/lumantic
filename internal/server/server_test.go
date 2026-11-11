package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lumantic/internal/adapter"
	"lumantic/internal/ai"
	"lumantic/internal/catalog"
	"lumantic/internal/config"
	"lumantic/internal/store"
)

// fakeSource is a gold layer with one monthly table g.monat (monat, wert, kredite).
type fakeSource struct{ name string }

func (f *fakeSource) Name() string    { return "fake-" + f.name }
func (f *fakeSource) Dialect() string { return "duckdb" }
func (f *fakeSource) Describe(context.Context) (*catalog.Catalog, error) {
	return &catalog.Catalog{Source: "Test", Dialect: "duckdb", Tables: []catalog.Table{{Name: "g.monat", Columns: []catalog.Column{
		{Name: "monat", Type: "DATE", Role: catalog.RoleTime}, {Name: "wert", Type: "DOUBLE", Role: catalog.RoleMeasure},
		{Name: "kredite", Type: "DOUBLE", Role: catalog.RoleMeasure}}}}}, nil
}
func (f *fakeSource) Query(_ context.Context, sql string) ([]adapter.Row, error) {
	switch {
	case strings.Contains(sql, "count(*)"):
		return []adapter.Row{{"t": "g.monat", "n": 3.0}}, nil
	case strings.Contains(sql, "strftime"):
		return []adapter.Row{{"p": "2026-01", "c0": 10.0, "c1": 900.0}, {"p": "2026-02", "c0": 11.0, "c1": 910.0}, {"p": "2026-03", "c0": 12.0, "c1": 920.0}}, nil
	}
	return []adapter.Row{}, nil
}

type brokenSource struct{}

func (brokenSource) Name() string    { return "broken" }
func (brokenSource) Dialect() string { return "duckdb" }
func (brokenSource) Describe(context.Context) (*catalog.Catalog, error) {
	return nil, errors.New("Verbindung abgelehnt")
}
func (brokenSource) Query(context.Context, string) ([]adapter.Row, error) {
	return nil, errors.New("Verbindung abgelehnt")
}

// fakeLumina answers by the question: "passt nicht" → NoFit, "kaputt" → error.
type fakeLumina struct {
	set    ai.Settings
	asked  []ai.Question
	tested int
}

func (f *fakeLumina) Model() string { return f.set.Model }
func (f *fakeLumina) Ask(_ context.Context, q ai.Question) (*ai.Answer, error) {
	f.asked = append(f.asked, q)
	switch q.Question {
	case "passt nicht":
		return nil, &ai.NoFit{Msg: "Dazu gibt es keine Zahlen."}
	case "kaputt":
		return nil, errors.New("Anthropic ist gerade nicht erreichbar (529).")
	}
	return &ai.Answer{Answer: "Die LCR sinkt.", Blocks: []ai.Block{{Figure: q.Facts.Figures[0].ID, View: "trend"}}, Model: f.set.Model, Ms: 1}, nil
}
func (f *fakeLumina) Test(context.Context) error { f.tested++; return nil }

const testMetrics = `{"title":"Test","source":"Test","groups":[{"id":"a","name":"A"}],
 "kpis":[{"id":"x","group":"a","name":"Wert","unit":"%","kind":"stock","dir":1,"target":11,"monthly":{"table":"g.monat","value":"wert"}}]}`

type env struct {
	t       *testing.T
	dir     string
	srv     *Server
	h       http.Handler
	lum     *fakeLumina
	vars    map[string]string
	cfgPath string
}

// newEnv starts a server in a temp dir. withMetrics writes a definitions file
// and points the config at it; otherwise the built-in ALCO definitions apply.
func newEnv(t *testing.T, withMetrics bool, vars map[string]string) *env {
	t.Helper()
	dir := t.TempDir()
	e := &env{t: t, dir: dir, vars: vars, cfgPath: filepath.Join(dir, "config", "lumantic.json")}
	if withMetrics {
		mp := filepath.Join(dir, "kennzahlen-basis.json")
		os.WriteFile(mp, []byte(testMetrics), 0o644)
		os.MkdirAll(filepath.Dir(e.cfgPath), 0o755)
		raw, _ := json.Marshal(map[string]any{"data": map[string]any{"type": "duckdb", "path": "eins"}, "metrics": filepath.ToSlash(mp)})
		os.WriteFile(e.cfgPath, raw, 0o644)
	}
	lookup := func(k string) (string, bool) { v, ok := vars[k]; return v, ok }
	cfg, err := config.Open(e.cfgPath, filepath.Join(dir, "data", "secrets.json"), lookup)
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dir, "data", "board.json"), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	e.srv = &Server{Store: st, Config: cfg,
		BuildSource: func(d config.Data, secret func(string) string) (adapter.Adapter, error) {
			switch d.Path {
			case "kaputt":
				return nil, errors.New("Die Datei kaputt gibt es nicht.")
			case "offline":
				return brokenSource{}, nil
			}
			return &fakeSource{name: d.Path}, nil
		},
		NewLumina: func(s ai.Settings) ai.Lumina { e.lum = &fakeLumina{set: s}; return e.lum },
	}
	e.srv.Start(context.Background())
	e.h = e.srv.Routes()
	return e
}

func (e *env) do(method, path, body string, headers ...string) (int, map[string]any) {
	e.t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, "http://127.0.0.1:8080"+path, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func get(m map[string]any, path string) any {
	var cur any = m
	for _, k := range strings.Split(path, ".") {
		mm, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = mm[k]
	}
	return cur
}

func TestSettingsShowSourceStatusAndModels(t *testing.T) {
	e := newEnv(t, true, nil)
	code, s := e.do("GET", "/api/settings", "")
	if code != 200 || get(s, "version") != config.Version || get(s, "status.ok") != true {
		t.Fatalf("%d %v", code, s)
	}
	if get(s, "status.tables").(float64) != 1 || get(s, "status.kpisLoaded").(float64) != 1 || get(s, "status.first") != "2026-01" || get(s, "status.last") != "2026-03" {
		t.Fatalf("status %v", get(s, "status"))
	}
	if get(s, "data.path") != "eins" || get(s, "ai.ready") != false || len(get(s, "ai.models").([]any)) != 3 || get(s, "data.windmill.token.set") != false {
		t.Fatalf("settings %v", s)
	}
	if code, m := e.do("GET", "/api/metrics", ""); code != 200 || len(m["kpis"].([]any)) != 1 {
		t.Fatalf("metrics %d %v", code, m)
	}
}

func TestGuardRefusesOtherSites(t *testing.T) {
	e := newEnv(t, true, nil)
	if code, _ := e.do("POST", "/api/refresh", "", "Origin", "https://boese.example"); code != 403 {
		t.Fatalf("foreign origin: %d", code)
	}
	if code, _ := e.do("PUT", "/api/settings", `{"ui":{"design":"stein"}}`, "Sec-Fetch-Site", "cross-site"); code != 403 {
		t.Fatalf("cross-site: %d", code)
	}
	if code, _ := e.do("PUT", "/api/settings", `{"ui":{"design":"stein"}}`, "Content-Type", "text/plain"); code != 415 {
		t.Fatalf("text/plain: %d", code)
	}
	if code, _ := e.do("POST", "/api/refresh", "", "Origin", "http://127.0.0.1:8080", "Sec-Fetch-Site", "same-origin"); code != 200 {
		t.Fatalf("same origin refused: %d", code)
	}
	if code, _ := e.do("GET", "/api/settings", "", "Origin", "https://boese.example"); code != 200 {
		t.Fatalf("reading must stay open: %d", code)
	}
}

func TestPutSettingsSavesUIAndKeepsEchoedFields(t *testing.T) {
	e := newEnv(t, true, nil)
	_, s := e.do("GET", "/api/settings", "")
	s["ui"].(map[string]any)["design"] = "stein"
	raw, _ := json.Marshal(s) // the whole GET answer sent back
	code, out := e.do("PUT", "/api/settings", string(raw))
	if code != 200 || get(out, "ui.design") != "stein" {
		t.Fatalf("%d %v", code, out)
	}
	file, _ := os.ReadFile(e.cfgPath)
	if !strings.Contains(string(file), `"design": "stein"`) || strings.Contains(string(file), "status") {
		t.Fatalf("file %s", file)
	}
	if code, out := e.do("PUT", "/api/settings", `{"ui":{"accent":"rot"}}`); code != 422 || out["error"] == "" {
		t.Fatalf("bad accent: %d %v", code, out)
	}
}

func TestLockedFieldCannotChange(t *testing.T) {
	e := newEnv(t, true, map[string]string{"LUMANTIC_GOLD": "eins"})
	_, s := e.do("GET", "/api/settings", "")
	if !strings.Contains(strings.Join(toStrings(s["locked"]), ","), "data.path") {
		t.Fatalf("locked %v", s["locked"])
	}
	if code, out := e.do("PUT", "/api/settings", `{"data":{"path":"zwei"}}`); code != 409 || !strings.Contains(out["error"].(string), "LUMANTIC_GOLD") {
		t.Fatalf("%d %v", code, out)
	}
	if code, _ := e.do("PUT", "/api/settings", `{"data":{"path":"eins","name":"Neu"}}`); code != 200 {
		t.Fatalf("unchanged locked value refused: %d", code)
	}
}

func toStrings(v any) []string {
	var out []string
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

func TestFailedSourceLeavesConfigInPlace(t *testing.T) {
	e := newEnv(t, true, nil)
	before, _ := os.ReadFile(e.cfgPath)
	for _, path := range []string{"kaputt", "offline"} {
		code, out := e.do("PUT", "/api/settings", `{"data":{"path":"`+path+`"}}`)
		if code != 422 || out["error"] == "" {
			t.Fatalf("%s: %d %v", path, code, out)
		}
	}
	after, _ := os.ReadFile(e.cfgPath)
	if string(before) != string(after) {
		t.Fatal("config changed although the source failed")
	}
	_, s := e.do("GET", "/api/settings", "")
	if get(s, "data.path") != "eins" || get(s, "status.ok") != true {
		t.Fatalf("old source gone: %v", s)
	}
	code, out := e.do("PUT", "/api/settings", `{"data":{"path":"zwei"}}`)
	if code != 200 || get(out, "data.path") != "zwei" || get(out, "status.ok") != true || e.srv.adapter().Name() != "fake-zwei" {
		t.Fatalf("switch: %d %v", code, out)
	}
}

func TestDataTest(t *testing.T) {
	e := newEnv(t, true, nil)
	for _, body := range []string{`{"type":"duckdb","path":"neu"}`, `{"data":{"type":"duckdb","path":"neu"}}`} {
		code, out := e.do("POST", "/api/settings/data/test", body)
		tables, _ := out["tables"].([]any)
		if code != 200 || out["ok"] != true || len(tables) != 1 {
			t.Fatalf("%s: %d %v", body, code, out)
		}
		tb := tables[0].(map[string]any)
		if tb["name"] != "g.monat" || tb["time"] != "monat" || tb["rows"].(float64) != 3 || len(tb["columns"].([]any)) != 3 {
			t.Fatalf("table %v", tb)
		}
	}
	if _, out := e.do("POST", "/api/settings/data/test", `{"path":"kaputt"}`); out["ok"] != false || out["error"] == "" {
		t.Fatalf("broken: %v", out)
	}
	if _, out := e.do("POST", "/api/settings/data/test", `{"type":"windmill","windmill":{"url":"kein-url"}}`); out["ok"] != false {
		t.Fatalf("invalid windmill: %v", out)
	}
	if _, s := e.do("GET", "/api/settings", ""); get(s, "data.path") != "eins" {
		t.Fatal("a test must not save")
	}
}

func TestSecretMakesLuminaReady(t *testing.T) {
	e := newEnv(t, true, nil)
	if _, out := e.do("POST", "/api/settings/ai/test", ""); out["ok"] != false || out["error"] == "" {
		t.Fatalf("test without token: %v", out)
	}
	if code, _ := e.do("POST", "/api/lumina/ask", `{"question":"Warum?","facts":{"figures":[{"id":"x"}]}}`); code != 409 {
		t.Fatalf("ask without token: %d", code)
	}
	code, out := e.do("PUT", "/api/settings/secret", `{"key":"anthropicToken","value":"sk-ant-test-1234wxyz"}`)
	if code != 200 || out["set"] != true || out["hint"] != "wxyz" || out["source"] != "datei" {
		t.Fatalf("%d %v", code, out)
	}
	_, s := e.do("GET", "/api/settings", "")
	if get(s, "ai.ready") != true || get(s, "ai.token.hint") != "wxyz" || strings.Contains(mustJSON(s), "sk-ant-test") {
		t.Fatalf("settings leak or not ready: %v", get(s, "ai"))
	}
	if e.lum == nil || e.lum.set.Token != "sk-ant-test-1234wxyz" || e.lum.set.Model != "claude-opus-5-5" {
		t.Fatalf("lumina built with %+v", e.lum)
	}
	if _, out := e.do("POST", "/api/settings/ai/test", ""); out["ok"] != true || e.lum.tested != 1 {
		t.Fatalf("ai test: %v", out)
	}
	code, out = e.do("PUT", "/api/settings", `{"ai":{"model":"claude-haiku-5-5","baseURL":"https://gateway.example.ch/anthropic"}}`)
	if code != 200 || e.lum.set.Model != "claude-haiku-5-5" || e.lum.set.BaseURL != "https://gateway.example.ch/anthropic" {
		t.Fatalf("model change: %d %+v", code, e.lum.set)
	}
	if code, _ := e.do("PUT", "/api/settings/secret", `{"key":"anthropicToken","value":""}`); code != 200 {
		t.Fatal("delete token")
	}
	if _, s := e.do("GET", "/api/settings", ""); get(s, "ai.ready") != false {
		t.Fatal("still ready without token")
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestSecretFromEnvIsLocked(t *testing.T) {
	e := newEnv(t, true, map[string]string{"ANTHROPIC_API_KEY": "sk-ant-env-0000abcd"})
	if code, _ := e.do("PUT", "/api/settings/secret", `{"key":"anthropicToken","value":"sk-ant-x-12345678"}`); code != 409 {
		t.Fatalf("env token overwritten: %d", code)
	}
	_, s := e.do("GET", "/api/settings", "")
	if get(s, "ai.token.source") != "umgebung" || get(s, "ai.ready") != true {
		t.Fatalf("%v", get(s, "ai"))
	}
}

func TestAsk(t *testing.T) {
	e := newEnv(t, true, map[string]string{"ANTHROPIC_API_KEY": "sk-ant-env-0000abcd"})
	facts := `"month":"2026-03","facts":{"title":"Test","month":"März 2026","figures":[{"id":"x","name":"Wert","unit":"%","value":12,"prev":11,"target":11,"level":"calm","last13":[10,11,12]}]}`
	code, out := e.do("POST", "/api/lumina/ask", `{"question":"Wie steht der Wert?",`+facts+`}`)
	if code != 200 || out["answer"] != "Die LCR sinkt." || len(out["blocks"].([]any)) != 1 {
		t.Fatalf("%d %v", code, out)
	}
	if v := e.lum.asked[0].Facts.Figures[0].Value; v == nil || *v != 12 {
		t.Fatal("facts not passed on")
	}
	if code, out := e.do("POST", "/api/lumina/ask", `{"question":"passt nicht",`+facts+`}`); code != 422 || out["error"] != "Dazu gibt es keine Zahlen." {
		t.Fatalf("no fit: %d %v", code, out)
	}
	if code, _ := e.do("POST", "/api/lumina/ask", `{"question":"kaputt",`+facts+`}`); code != 502 {
		t.Fatalf("failure: %d", code)
	}
	if code, _ := e.do("POST", "/api/lumina/ask", `{"question":"  ",`+facts+`}`); code != 400 {
		t.Fatalf("empty: %d", code)
	}
	if code, _ := e.do("POST", "/api/lumina/ask", `{"question":"Warum?","facts":{"figures":[]}}`); code != 400 {
		t.Fatalf("no facts: %d", code)
	}
}

func TestKPIsCopyBuiltInAndEdit(t *testing.T) {
	e := newEnv(t, false, nil) // built-in ALCO definitions: none of them is in the fake source
	code, out := e.do("GET", "/api/kpis", "")
	if code != 200 || out["builtIn"] != true || out["file"] != "" || len(out["kpis"].([]any)) != 11 {
		t.Fatalf("%d %v", code, out)
	}
	if st := out["kpis"].([]any)[0].(map[string]any)["status"].(string); !strings.HasPrefix(st, "fehlt: ") {
		t.Fatalf("status %s", st)
	}
	if code, _ := e.do("GET", "/api/metrics", ""); code != 503 {
		t.Fatalf("metrics without usable figures: %d", code)
	}
	code, out = e.do("POST", "/api/kpis", `{"name":"Kreditvolumen","unit":"Mio","dec":0,"kind":"stock","dir":1,"target":900,"limit":null,
		"group":"","groupName":"Kredite","monthly":{"table":"g.monat","value":"kredite"}}`)
	if code != 201 || out["id"] != "kreditvolumen" || out["group"] != "kredite" || out["status"] != "ok" {
		t.Fatalf("add: %d %v", code, out)
	}
	kp := filepath.Join(e.dir, "config", "kennzahlen.json")
	raw, err := os.ReadFile(kp)
	if err != nil || !strings.Contains(string(raw), `"kreditvolumen"`) || !strings.Contains(string(raw), `"lcr"`) {
		t.Fatalf("kennzahlen.json: %v", err)
	}
	cfg, _ := os.ReadFile(e.cfgPath)
	if !strings.Contains(string(cfg), "kennzahlen.json") {
		t.Fatalf("config not pointed at the file: %s", cfg)
	}
	if code, m := e.do("GET", "/api/metrics", ""); code != 200 || len(m["kpis"].([]any)) != 1 {
		t.Fatalf("the new figure must load on its own: %d %v", code, m)
	}
	code, out = e.do("POST", "/api/kpis", `{"name":"Falsch","unit":"Mio","kind":"stock","group":"kredite","monthly":{"table":"g.monat","value":"gibtsnicht"}}`)
	if code != 422 || !strings.Contains(out["error"].(string), "g.monat.gibtsnicht") {
		t.Fatalf("missing column: %d %v", code, out)
	}
	if code, _ := e.do("POST", "/api/kpis", `{"id":"kreditvolumen","name":"Doppelt","unit":"Mio","kind":"stock","group":"kredite","monthly":{"table":"g.monat","value":"kredite"}}`); code != 409 {
		t.Fatalf("duplicate: %d", code)
	}
	code, out = e.do("PUT", "/api/kpis/kreditvolumen", `{"target":950,"limit":800,"dir":1,"name":"Kredite"}`)
	if code != 200 || out["target"].(float64) != 950 || out["limit"].(float64) != 800 || out["name"] != "Kredite" || out["monthly"].(map[string]any)["value"] != "kredite" {
		t.Fatalf("update: %d %v", code, out)
	}
	if code, out := e.do("PUT", "/api/kpis/kreditvolumen", `{"unit":"CHF"}`); code != 422 {
		t.Fatalf("bad unit: %d %v", code, out)
	}
	if code, _ := e.do("DELETE", "/api/kpis/kreditvolumen", ""); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := e.do("DELETE", "/api/kpis/kreditvolumen", ""); code != 404 {
		t.Fatalf("delete again: %d", code)
	}
	if _, out := e.do("GET", "/api/kpis", ""); out["builtIn"] != false || len(out["kpis"].([]any)) != 11 {
		t.Fatalf("after delete: %v", out["file"])
	}
}

func TestBrandSettingsAndFiles(t *testing.T) {
	e := newEnv(t, true, nil)
	if code, out := e.do("PUT", "/api/settings", `{"brand":{"designs":[{"id":"musterbank","base":"kreide","colors":{"ink":"expression(alert(1))"}}]}}`); code != 422 {
		t.Fatalf("bad colour accepted: %d %v", code, out)
	}
	code, out := e.do("PUT", "/api/settings", `{"brand":{"name":"Musterbank","designs":[{"id":"musterbank","name":"Musterbank","base":"kreide","colors":{"accent":"#00539f","wasauchimmer":"#fff"}}]}}`)
	designs, _ := get(out, "brand.designs").([]any)
	if code != 200 || len(designs) != 1 || get(out, "brand.name") != "Musterbank" {
		t.Fatalf("%d %v", code, out)
	}
	if c := designs[0].(map[string]any)["colors"].(map[string]any); c["accent"] != "#00539f" || c["wasauchimmer"] != nil {
		t.Fatalf("colours %v", c)
	}
	brand := filepath.Join(e.dir, "config", "brand", "fonts")
	os.MkdirAll(brand, 0o755)
	os.WriteFile(filepath.Join(brand, "haus.woff2"), []byte("wOF2"), 0o644)
	os.WriteFile(filepath.Join(e.dir, "config", "brand", "logo.svg"), []byte("<svg/>"), 0o644)
	for path, want := range map[string]int{
		"/brand/fonts/haus.woff2":    200,
		"/brand/logo.svg":            200,
		"/brand/fonts/":              404,
		"/brand/../lumantic.json":    404,
		"/brand/fonts/../../x.woff2": 404,
		"/brand/lumantic.json":       404,
	} {
		req := httptest.NewRequest("GET", "http://127.0.0.1:8080"+path, nil)
		rec := httptest.NewRecorder()
		e.h.ServeHTTP(rec, req)
		// The mux answers paths with ".." by redirecting to the cleaned path (301 or 307,
		// depending on the Go version), which lies outside /brand/; either way nothing
		// from config/ is served.
		redirected := rec.Code == 301 || rec.Code == 307
		if rec.Code != want && !(want == 404 && redirected && !strings.HasPrefix(rec.Header().Get("Location"), "/brand/")) {
			t.Errorf("%s: %d, want %d", path, rec.Code, want)
		}
		if want == 200 && path == "/brand/fonts/haus.woff2" && rec.Header().Get("Content-Type") != "font/woff2" {
			t.Errorf("content type %s", rec.Header().Get("Content-Type"))
		}
	}
}

func TestStartsWithoutSource(t *testing.T) {
	e := newEnv(t, false, map[string]string{"LUMANTIC_GOLD": "kaputt"})
	if code, out := e.do("GET", "/api/metrics", ""); code != 503 || out["error"] == "" {
		t.Fatalf("metrics: %d %v", code, out)
	}
	_, s := e.do("GET", "/api/settings", "")
	if get(s, "status.ok") != false || !strings.Contains(get(s, "status.error").(string), "kaputt") {
		t.Fatalf("status %v", get(s, "status"))
	}
	if code, _ := e.do("GET", "/api/meta", ""); code != 200 {
		t.Fatalf("legacy meta: %d", code)
	}
	if code, _ := e.do("GET", "/api/board", ""); code != 200 {
		t.Fatalf("legacy board: %d", code)
	}
}
