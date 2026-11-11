package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/auth"
	"github.com/Dominik1407/lumantic/internal/config"
)

// fakeLogin signs people in by a test header, as a proxy or a provider would.
type fakeLogin struct {
	users  map[string]auth.User
	tokens map[string]string
}

func (f fakeLogin) Kind() string { return "oidc" }
func (f fakeLogin) User(r *http.Request) (auth.User, bool) {
	u, ok := f.users[r.Header.Get("X-Test-User")]
	return u, ok
}
func (f fakeLogin) Token(_ context.Context, r *http.Request) (string, error) {
	return f.tokens[r.Header.Get("X-Test-User")], nil
}
func (f fakeLogin) Routes(*http.ServeMux)       {}
func (f fakeLogin) LoginURL(next string) string { return "/auth/login?next=" + url.QueryEscape(next) }
func (f fakeLogin) LogoutURL() string           { return "/auth/logout" }

// personSource answers in a person's name with figures of their own.
type personSource struct {
	*fakeSource
	as *atomic.Int32
}

func (p personSource) As(_ context.Context, who adapter.Person) (adapter.Adapter, error) {
	p.as.Add(1)
	return personFigures{&fakeSource{name: who.ID}, who.Token}, nil
}

type personFigures struct {
	*fakeSource
	token string
}

func (p personFigures) Query(ctx context.Context, sql string) ([]adapter.Row, error) {
	rows, err := p.fakeSource.Query(ctx, sql)
	if strings.Contains(sql, "strftime") && p.token == "tok-mia" {
		rows[len(rows)-1] = adapter.Row{"p": "2026-03", "c0": 77.0, "c1": 920.0}
	}
	return rows, err
}

const twoFigures = `{"title":"Test","source":"Test","groups":[{"id":"a","name":"A"}],
 "kpis":[{"id":"x","group":"a","name":"Wert","unit":"%","kind":"stock","dir":1,"monthly":{"table":"g.monat","value":"wert"}},
         {"id":"y","group":"a","name":"Geheim","unit":"Mio","kind":"flow","dir":1,"access":["GG-Geheim"],"monthly":{"table":"g.monat","value":"kredite"}}]}`

// signedIn starts a server with a login, three Kosmen and these people:
// mia sees the first Kosmos, pia also looks after its key figures, ada is an
// admin; the third Kosmos reads its figures in each person's name.
func signedIn(t *testing.T) (*env, *atomic.Int32) {
	t.Helper()
	e := newEnv(t, true, nil)
	defs := filepath.Join(e.dir, "zwei-kennzahlen.json")
	os.WriteFile(defs, []byte(twoFigures), 0o644)
	var c map[string]any
	raw, _ := os.ReadFile(e.cfgPath)
	json.Unmarshal(raw, &c)
	c["metrics"] = filepath.ToSlash(defs)
	c["auth"] = map[string]any{"kind": "oidc", "admins": []string{"GG-Admin"}, "oidc": map[string]any{"issuer": "https://idp.example/", "clientId": "lumantic"}}
	c["access"], c["editors"] = []string{"GG-ALCO"}, []string{"GG-ALCO-Pflege"}
	c["kosmen"] = []any{
		map[string]any{"id": "zwei", "access": []string{"GG-Zwei"}, "data": map[string]any{"type": "duckdb", "name": "Zwei", "path": "zwei"}},
		map[string]any{"id": "drei", "rights": "source", "metrics": filepath.ToSlash(defs),
			"data": map[string]any{"type": "databricks", "name": "Drei", "databricks": map[string]any{"host": "https://adb.example", "warehouse": "w", "auth": "token"}}},
	}
	raw, _ = json.Marshal(c)
	os.WriteFile(e.cfgPath, raw, 0o644)
	var as atomic.Int32
	fake := e.srv.BuildSource
	e.srv.BuildSource = func(d config.Data, secret func(string) string) (adapter.Adapter, error) {
		if d.Type == "databricks" {
			return personSource{&fakeSource{name: "technisch"}, &as}, nil
		}
		return fake(d, secret)
	}
	srv := restart(t, e)
	srv.BuildSource = e.srv.BuildSource
	srv.Auth = fakeLogin{users: map[string]auth.User{
		"mia":  {ID: "mmuster", Name: "Mia Muster", Groups: []string{"GG-ALCO"}},
		"pia":  {ID: "pmuster", Name: "Pia Muster", Groups: []string{"gg-alco", "GG-ALCO-Pflege"}},
		"ada":  {ID: "admin", Name: "Ada", Groups: []string{"GG-Admin", "GG-Geheim"}},
		"ohne": {ID: "ohne", Name: "Ohne Token", Groups: []string{}},
	}, tokens: map[string]string{"mia": "tok-mia", "ada": "tok-ada"}}
	srv.AccessLog = filepath.Join(e.dir, "data", "zugriff.log")
	srv.Start(context.Background())
	e.srv, e.h = srv, srv.Routes()
	return e, &as
}

func ids(out map[string]any) string {
	var names []string
	for _, k := range out["kosmen"].([]any) {
		names = append(names, k.(map[string]any)["id"].(string))
	}
	return strings.Join(names, ",")
}

func TestNobodyGetsInWithoutSigningIn(t *testing.T) {
	e, _ := signedIn(t)
	code, out := e.do("GET", "/api/kosmen", "")
	if code != 401 || out["login"] != "/auth/login?next=%2F" {
		t.Fatalf("%d %v", code, out)
	}
	req := httptestRequest("GET", "/?k=zwei")
	rec := serve(e, req)
	if rec.Code != 302 || rec.Header().Get("Location") != "/auth/login?next=%2F%3Fk%3Dzwei" {
		t.Fatalf("a page sends to the login: %d %q", rec.Code, rec.Header().Get("Location"))
	}
}

func TestEachSeesTheirKosmenAndFigures(t *testing.T) {
	e, _ := signedIn(t)
	if _, out := e.do("GET", "/api/kosmen", "", "X-Test-User", "mia"); ids(out) != "main,drei" {
		t.Fatalf("mia sees %s", ids(out))
	}
	if _, out := e.do("GET", "/api/kosmen", "", "X-Test-User", "ada"); ids(out) != "main,zwei,drei" {
		t.Fatalf("an admin sees every Kosmos, got %s", ids(out))
	}
	if code, out := e.do("GET", "/api/metrics?k=zwei", "", "X-Test-User", "mia"); code != 403 || !strings.Contains(out["error"].(string), "nicht sehen") {
		t.Fatalf("%d %v", code, out)
	}
	figures := func(who string) string {
		_, m := e.do("GET", "/api/metrics", "", "X-Test-User", who)
		var names []string
		for _, k := range m["kpis"].([]any) {
			names = append(names, k.(map[string]any)["id"].(string))
		}
		return strings.Join(names, ",")
	}
	if got := figures("mia"); got != "x" {
		t.Errorf("a figure for other groups is left out: %s", got)
	}
	if got := figures("ada"); got != "x,y" {
		t.Errorf("an admin sees every figure: %s", got)
	}
}

func TestOnlyAdminsChangeAndEditorsLookAfterFigures(t *testing.T) {
	e, _ := signedIn(t)
	for _, c := range []struct{ method, path, body string }{
		{"PUT", "/api/settings", `{"ui":{"design":"stein"}}`},
		{"POST", "/api/settings/data/test", `{"type":"duckdb","path":"x"}`},
		{"PUT", "/api/settings/secret", `{"key":"anthropicToken","value":"sk-ant-12345678"}`},
		{"POST", "/api/kosmen", `{"data":{"type":"duckdb","name":"Neu","path":"neu"}}`},
		{"POST", "/api/refresh/token", ""},
		{"GET", "/api/board", ""},
	} {
		if code, out := e.do(c.method, c.path, c.body, "X-Test-User", "pia"); code != 403 {
			t.Errorf("%s %s: %d %v", c.method, c.path, code, out)
		}
	}
	if code, _ := e.do("PUT", "/api/kpis/x", `{"target":12}`, "X-Test-User", "mia"); code != 403 {
		t.Fatalf("mia does not look after the figures: %d", code)
	}
	if code, out := e.do("PUT", "/api/kpis/x", `{"target":12,"access":["GG-Pia"]}`, "X-Test-User", "pia"); code != 200 {
		t.Fatalf("pia looks after them: %d %v", code, out)
	}
	_, list := e.do("GET", "/api/kpis", "", "X-Test-User", "ada")
	x := list["kpis"].([]any)[0].(map[string]any)
	if x["target"].(float64) != 12 || x["access"] != nil {
		t.Fatalf("an editor changes the target, not who sees it: %v", x)
	}
	if code, _ := e.do("PUT", "/api/settings", `{"ui":{"design":"stein"}}`, "X-Test-User", "ada"); code != 200 {
		t.Fatalf("an admin changes settings: %d", code)
	}
	_, s := e.do("GET", "/api/settings", "", "X-Test-User", "mia")
	if get(s, "me.admin") != false || get(s, "me.editor") != false || get(s, "me.name") != "Mia Muster" || get(s, "data.path") != "" || get(s, "configPath") != "" {
		t.Fatalf("what mia is told: me=%v data=%v", s["me"], s["data"])
	}
	if _, s := e.do("GET", "/api/settings", "", "X-Test-User", "pia"); get(s, "me.editor") != true {
		t.Fatalf("pia: %v", s["me"])
	}
}

func TestEachKeepsTheirOwnPages(t *testing.T) {
	e, _ := signedIn(t)
	e.do("PUT", "/api/workspace", `{"v":2,"kosmos":{"pages":["vor dem Login"]}}`, "X-Test-User", "ada")
	shared, _ := json.Marshal(map[string]any{"v": 2, "kosmos": map[string]any{"pages": []string{"geteilt"}}})
	e.srv.Store.SetWorkspace(shared)
	e.do("PUT", "/api/workspace", `{"v":2,"kosmos":{"pages":["mias"]}}`, "X-Test-User", "mia")
	if _, w := e.do("GET", "/api/workspace", "", "X-Test-User", "mia"); !strings.Contains(mustJSON(w), "mias") {
		t.Fatalf("mia: %v", w)
	}
	if _, w := e.do("GET", "/api/workspace", "", "X-Test-User", "pia"); !strings.Contains(mustJSON(w), "geteilt") {
		t.Fatalf("pia starts from the shared pages: %v", w)
	}
	if _, w := e.do("GET", "/api/workspace", "", "X-Test-User", "ada"); !strings.Contains(mustJSON(w), "vor dem Login") {
		t.Fatalf("ada: %v", w)
	}
}

func TestAccessLogAndLoadingJobs(t *testing.T) {
	e, _ := signedIn(t)
	e.do("GET", "/api/metrics", "", "X-Test-User", "mia")
	e.do("GET", "/api/metrics", "", "X-Test-User", "mia")
	raw, _ := os.ReadFile(e.srv.AccessLog)
	if lines := strings.Count(string(raw), "\n"); lines != 1 || !strings.Contains(string(raw), `"user":"mmuster"`) || strings.Contains(string(raw), "series") {
		t.Fatalf("one line per person and Kosmos, no figures: %s", raw)
	}
	// A loading job has no login, only its token.
	code, out := e.do("POST", "/api/refresh/token", "", "X-Test-User", "ada")
	tok, _ := out["token"].(string)
	if code != 201 {
		t.Fatalf("%d %v", code, out)
	}
	if code, _ := e.do("POST", "/api/refresh", "", "Authorization", "Bearer "+tok); code != 202 {
		t.Fatalf("the job's token lets it through: %d", code)
	}
	e.srv.bg.Wait()
	if code, _ := e.do("POST", "/api/refresh", ""); code != 401 {
		t.Fatalf("without token or login: %d", code)
	}
}

// Weg 2: the figures are read in each person's name, once per read of the Kosmos.
func TestFiguresInThePersonsName(t *testing.T) {
	e, as := signedIn(t)
	if _, s := e.do("GET", "/api/settings?k=drei", "", "X-Test-User", "ada"); get(s, "status.ok") != true {
		t.Fatalf("the Kosmos is ready without shared figures: %v", s["status"])
	}
	last := func(who string) (float64, int, map[string]any) {
		code, m := e.do("GET", "/api/metrics?k=drei", "", "X-Test-User", who)
		if code != 200 {
			return 0, code, m
		}
		s := m["kpis"].([]any)[0].(map[string]any)["series"].([]any)
		return s[len(s)-1].(float64), code, m
	}
	if v, code, m := last("mia"); code != 200 || v != 77 {
		t.Fatalf("mia's own figures: %v %d %v", v, code, m)
	}
	if v, _, _ := last("ada"); v != 12 {
		t.Fatalf("ada's own figures: %v", v)
	}
	last("mia")
	if as.Load() != 2 {
		t.Fatalf("read once per person: %d", as.Load())
	}
	e.srv.readNow(context.Background(), "drei", byHand)
	last("mia")
	if as.Load() != 3 {
		t.Fatalf("a new read of the Kosmos reads mia's figures again: %d", as.Load())
	}
	if _, code, m := last("ohne"); code != 503 || !strings.Contains(m["error"].(string), "OpenID Connect") {
		t.Fatalf("without a token: %d %v", code, m)
	}
}

func TestRightsInTheSettings(t *testing.T) {
	base := config.Auth{Kind: "oidc", OIDC: config.AuthOIDC{Issuer: "https://idp.example/", ClientID: "lumantic"}}
	config.NormalizeAuth(&base)
	c := config.Defaults()
	c.Auth = base
	c.Rights = "source"
	if err := config.Validate(c); err == nil || !strings.Contains(err.Error(), "Snowflake und Databricks") {
		t.Fatalf("a DuckDB file cannot answer in a person's name: %v", err)
	}
	c.Data = config.Data{Type: "databricks", Databricks: config.Databricks{Host: "https://x", Warehouse: "w", Auth: "token"}}
	if err := config.Validate(c); err != nil {
		t.Fatal(err)
	}
	c.Auth = config.Auth{Kind: "proxy"}
	config.NormalizeAuth(&c.Auth)
	if err := config.Validate(c); err == nil || !strings.Contains(err.Error(), "OpenID Connect") {
		t.Fatalf("a proxy gives no token: %v", err)
	}
	if !config.InGroups([]string{"gg-alco"}, []string{"GG-ALCO"}) || config.InGroups([]string{"x"}, []string{"y"}) || !config.InGroups(nil, nil) {
		t.Fatal("InGroups")
	}
}

func httptestRequest(method, path string) *http.Request {
	return httptest.NewRequest(method, "http://127.0.0.1:8080"+path, nil)
}

func serve(e *env, r *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, r)
	return rec
}
