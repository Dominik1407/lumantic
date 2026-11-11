package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/source"
)

// fakeDatabricks answers the SQL Statement API from one small table, enough for
// a Kosmos to describe its source, count rows and load its figures. Every
// statement it receives is kept in seen.
func fakeDatabricks(t *testing.T, token string, seen *[]string) *httptest.Server {
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(401)
			w.Write([]byte(`{"error_code":"UNAUTHENTICATED","message":"Invalid access token."}`))
			return
		}
		var req struct {
			Statement string `json:"statement"`
			Warehouse string `json:"warehouse_id"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		*seen = append(*seen, req.Statement)
		mu.Unlock()
		type col struct {
			Name     string `json:"name"`
			TypeName string `json:"type_name"`
			Position int    `json:"position"`
		}
		var names, types []string
		var rows [][]any
		s := req.Statement
		switch {
		case strings.Contains(s, "information_schema.columns"):
			names = []string{"schema_name", "table_name", "table_comment", "column_name", "data_type", "column_comment"}
			types = []string{"STRING", "STRING", "STRING", "STRING", "STRING", "STRING"}
			for _, c := range [][2]string{{"monat", "DATE"}, {"region", "STRING"}, {"volumen_mio_chf", "DECIMAL(18,2)"}} {
				rows = append(rows, []any{"gold", "kredite", "Kredite pro Monat", c[0], c[1], nil})
			}
		case strings.Contains(s, "SELECT DISTINCT"):
			names, types = []string{"t", "c", "v"}, []string{"STRING", "STRING", "STRING"}
			rows = [][]any{{"gold.kredite", "region", "Ost"}, {"gold.kredite", "region", "West"}}
		case strings.Contains(s, "count(*)"):
			names, types = []string{"t", "n"}, []string{"STRING", "LONG"}
			rows = [][]any{{"gold.kredite", "6"}}
		case strings.Contains(s, "date_format") && strings.Contains(s, " AS s"):
			names, types = []string{"p", "s", "c0"}, []string{"STRING", "STRING", "DOUBLE"}
			rows = [][]any{{"2026-09", "Ost", "400"}, {"2026-09", "West", "600"}, {"2026-10", "Ost", "420"}, {"2026-10", "West", "610"}}
		case strings.Contains(s, "date_format"):
			names, types = []string{"p", "c0"}, []string{"STRING", "DOUBLE"}
			rows = [][]any{{"2026-09", "1000"}, {"2026-10", "1030"}}
		default:
			w.WriteHeader(400)
			w.Write([]byte(`{"error_code":"BAD_REQUEST","message":"unexpected statement"}`))
			return
		}
		cols := make([]col, len(names))
		for i := range names {
			cols[i] = col{names[i], types[i], i}
		}
		json.NewEncoder(w).Encode(map[string]any{
			"statement_id": "st-1",
			"status":       map[string]any{"state": "SUCCEEDED"},
			"manifest":     map[string]any{"schema": map[string]any{"columns": cols}, "total_chunk_count": 1},
			"result":       map[string]any{"chunk_index": 0, "data_array": rows},
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

const riskMetrics = `{"title":"Risiko","source":"Databricks","groups":[{"id":"kre","name":"Kredite"}],
 "kpis":[{"id":"vol","group":"kre","name":"Kreditvolumen","unit":"Mio","kind":"stock","dir":1,
  "monthly":{"table":"gold.kredite","value":"volumen_mio_chf"},"parts":{"mode":"sum","split":"region"}}]}`

// A Kosmos over Databricks goes the whole way: tested with a typed-in token,
// created, its token kept for this Kosmos only, its figures read in the
// warehouse's SQL, and everything of it gone again when it is removed.
func TestKosmosOverDatabricks(t *testing.T) {
	e := newEnv(t, true, nil)
	fake := e.srv.BuildSource
	e.srv.BuildSource = func(d config.Data, secret func(string) string) (adapter.Adapter, error) {
		if d.Type == "databricks" {
			return source.Build(d, secret)
		}
		return fake(d, secret)
	}
	var seen []string
	dbx := fakeDatabricks(t, "dapi-test-1234", &seen)
	defs := filepath.Join(e.dir, "risiko.json")
	os.WriteFile(defs, []byte(riskMetrics), 0o644)
	data := `{"type":"databricks","name":"Risiko","schema":"gold","databricks":{"host":"` + dbx.URL + `","warehouse":"wh-1","catalog":"bank","auth":"token"}}`

	// The test uses a typed-in token once and keeps nothing.
	_, out := e.do("POST", "/api/settings/data/test", strings.TrimSuffix(data, "}")+`,"secrets":{"databricksToken":"falsch-0000"}}`)
	if out["ok"] != false || !strings.Contains(out["error"].(string), "lehnt die Anmeldung ab") {
		t.Fatalf("a wrong token should be named: %v", out)
	}
	_, out = e.do("POST", "/api/settings/data/test", strings.TrimSuffix(data, "}")+`,"secrets":{"databricksToken":"dapi-test-1234"}}`)
	if out["ok"] != true || len(out["tables"].([]any)) != 1 {
		t.Fatalf("test: %v", out)
	}
	if raw, _ := os.ReadFile(filepath.Join(e.dir, "data", "secrets.json")); strings.Contains(string(raw), "dapi-test") {
		t.Fatalf("a test must not store the token: %s", raw)
	}

	code, out := e.do("POST", "/api/kosmen", `{"data":`+data+`,"metrics":"`+filepath.ToSlash(defs)+`","secrets":{"databricksToken":"dapi-test-1234"}}`)
	if code != 201 || out["id"] != "risiko" || out["type"] != "databricks" || get(out, "status.ok") != true {
		t.Fatalf("add: %d %v", code, out)
	}
	_, m := e.do("GET", "/api/metrics?k=risiko", "")
	kpi := m["kpis"].([]any)[0].(map[string]any)
	series, parts := kpi["series"].([]any), kpi["parts"].([]any)
	if len(series) != 2 || series[1].(float64) != 1030 || len(parts) != 2 || parts[0].(map[string]any)["name"] != "Ost" {
		t.Fatalf("figures: %v", kpi)
	}
	for _, s := range seen {
		if strings.Contains(s, "strftime") || strings.Contains(s, `"`) {
			t.Errorf("DuckDB SQL reached Databricks: %s", s)
		}
	}
	if !strings.Contains(strings.Join(seen, "\n"), "FROM `gold`.`kredite` GROUP BY 1, 2") {
		t.Errorf("no split query in Databricks SQL: %v", seen)
	}

	// The token belongs to this Kosmos, is never shown again and is not in the config.
	_, s := e.do("GET", "/api/settings?k=risiko", "")
	if get(s, "data.databricks.token.set") != true || get(s, "data.databricks.token.hint") != "1234" || get(s, "data.databricks.warehouse") != "wh-1" {
		t.Fatalf("settings: %v", s["data"])
	}
	if strings.Contains(mustJSON(s), "dapi-test") {
		t.Fatal("the settings hand out the token")
	}
	cfg, _ := os.ReadFile(e.cfgPath)
	secrets, _ := os.ReadFile(filepath.Join(e.dir, "data", "secrets.json"))
	if strings.Contains(string(cfg), "dapi-test") || !strings.Contains(string(secrets), `"databricksToken@risiko"`) {
		t.Fatalf("config %s\nsecrets %s", cfg, secrets)
	}
	if _, s := e.do("GET", "/api/settings", ""); get(s, "data.databricks.token.set") != false {
		t.Fatal("the first Kosmos must not see the token of another")
	}

	// A new token for the Kosmos is stored under its name and read at once.
	if code, _ := e.do("PUT", "/api/settings/secret?k=risiko", `{"key":"databricksToken","value":"falsch-9999"}`); code != 200 {
		t.Fatalf("set secret: %d", code)
	}
	if _, st := e.do("GET", "/api/settings?k=risiko", ""); get(st, "status.ok") != false {
		t.Fatalf("with a wrong token the Kosmos should say so: %v", st["status"])
	}
	e.do("PUT", "/api/settings/secret?k=risiko", `{"key":"databricksToken","value":"dapi-test-1234"}`)
	if _, st := e.do("GET", "/api/settings?k=risiko", ""); get(st, "status.ok") != true {
		t.Fatalf("with the right token again: %v", st["status"])
	}

	if code, _ := e.do("DELETE", "/api/kosmen/risiko", ""); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if secrets, _ := os.ReadFile(filepath.Join(e.dir, "data", "secrets.json")); strings.Contains(string(secrets), "risiko") {
		t.Fatalf("the token outlived its Kosmos: %s", secrets)
	}
}
