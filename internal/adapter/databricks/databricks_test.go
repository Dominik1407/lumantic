package databricks

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"lumantic/internal/adapter"
	"lumantic/internal/catalog"
)

// result builds a SUCCEEDED statement with columns given as name, type_name
// and data as delivered with format JSON_ARRAY.
func result(cols [][2]string, data [][]any, next string) map[string]any {
	columns := make([]map[string]any, len(cols))
	for i, c := range cols {
		columns[i] = map[string]any{"name": c[0], "type_name": c[1], "type_text": c[1], "position": i}
	}
	res := map[string]any{"chunk_index": 0, "row_offset": 0, "row_count": len(data), "data_array": data}
	if next != "" {
		res["next_chunk_index"] = 1
		res["next_chunk_internal_link"] = next
	}
	return map[string]any{
		"statement_id": "s1",
		"status":       map[string]any{"state": "SUCCEEDED"},
		"manifest": map[string]any{
			"format": "JSON_ARRAY",
			"schema": map[string]any{"column_count": len(cols), "columns": columns},
		},
		"result": res,
	}
}

func state(id, s string) map[string]any {
	return map[string]any{"statement_id": id, "status": map[string]any{"state": s}}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// statementBody reads a submitted statement request.
func statementBody(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
		t.Errorf("request body: %v", err)
	}
	return m
}

var one = [][2]string{{"n", "INT"}}

func TestQuerySendsStatementWithBearerToken(t *testing.T) {
	var body map[string]any
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Method != http.MethodPost || r.URL.Path != "/api/2.0/sql/statements/" {
			t.Errorf("request %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer dapi-123" {
			t.Errorf("Authorization %q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "lumantic" {
			t.Errorf("User-Agent %q", got)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type %q", got)
		}
		body = statementBody(t, r)
		writeJSON(w, 200, result(one, [][]any{{"1"}}, ""))
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL + "/", Warehouse: "wh-1", Catalog: "bank", Auth: "token", Token: "dapi-123"}
	rows, err := d.Query(context.Background(), "SELECT 1 AS n")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0]["n"] != 1.0 {
		t.Fatalf("rows %v", rows)
	}
	want := map[string]any{
		"statement": "SELECT 1 AS n", "warehouse_id": "wh-1", "catalog": "bank",
		"wait_timeout": "30s", "on_wait_timeout": "CONTINUE", "disposition": "INLINE", "format": "JSON_ARRAY",
	}
	if len(body) != len(want) {
		t.Errorf("body has %d fields, want %d: %v", len(body), len(want), body)
	}
	for k, v := range want {
		if body[k] != v {
			t.Errorf("body[%s] = %v, want %v", k, body[k], v)
		}
	}

	// Without a catalog the warehouse's default applies, so none is sent.
	d = &Databricks{Host: srv.URL, Warehouse: "wh-1", Token: "dapi-123"}
	if _, err := d.Query(context.Background(), "SELECT 1 AS n"); err != nil {
		t.Fatal(err)
	}
	if _, ok := body["catalog"]; ok {
		t.Errorf("catalog sent although empty: %v", body)
	}
	if hits.Load() != 2 {
		t.Errorf("%d requests, want 2", hits.Load())
	}
}

func TestQueryConvertsTypes(t *testing.T) {
	cols := [][2]string{
		{"anzahl", "LONG"}, {"volumen_chf", "DECIMAL"}, {"quote", "DOUBLE"}, {"klein", "SHORT"},
		{"monat", "DATE"}, {"stand", "TIMESTAMP"}, {"lokal", "TIMESTAMP_NTZ"}, {"roh", "TIMESTAMP"},
		{"filiale", "STRING"}, {"aktiv", "BOOLEAN"}, {"leer", "LONG"},
	}
	data := [][]any{{
		"42", "1234567.89", "0.25", "-3",
		"2026-10-31", "2026-10-31T14:05:09.123Z", "2026-10-31 14:05:09", "gestern",
		"Zürich", "true", nil,
	}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, result(cols, data, ""))
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Token: "t"}
	rows, err := d.Query(context.Background(), "SELECT * FROM gold.kennzahlen")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows %v", rows)
	}
	want := adapter.Row{
		"anzahl": 42.0, "volumen_chf": 1234567.89, "quote": 0.25, "klein": -3.0,
		"monat": "2026-10-31", "stand": "2026-10-31T14:05:09", "lokal": "2026-10-31T14:05:09", "roh": "gestern",
		"filiale": "Zürich", "aktiv": "true", "leer": nil,
	}
	r := rows[0]
	if len(r) != len(want) {
		t.Errorf("row has %d keys, want %d: %v", len(r), len(want), r)
	}
	for k, v := range want {
		if got, ok := r[k]; !ok || got != v {
			t.Errorf("%s = %#v, want %#v", k, got, v)
		}
	}
	if f, ok := adapter.Float(r, "volumen_chf"); !ok || f != 1234567.89 {
		t.Errorf("adapter.Float: %v %v", f, ok)
	}
}

func TestQueryPollsUntilStatementSucceeds(t *testing.T) {
	var polls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/2.0/sql/statements/":
			writeJSON(w, 200, state("01ef-abc", "PENDING"))
		case r.Method == http.MethodGet && r.URL.Path == "/api/2.0/sql/statements/01ef-abc":
			if r.Header.Get("Authorization") != "Bearer t" {
				t.Errorf("poll without token")
			}
			if polls.Add(1) == 1 {
				writeJSON(w, 200, state("01ef-abc", "RUNNING"))
				return
			}
			res := result(one, [][]any{{"7"}}, "")
			res["statement_id"] = "01ef-abc"
			writeJSON(w, 200, res)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Token: "t"}
	rows, err := d.Query(context.Background(), "SELECT 7 AS n")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0]["n"] != 7.0 {
		t.Fatalf("rows %v", rows)
	}
	if polls.Load() != 2 {
		t.Errorf("%d polls, want 2", polls.Load())
	}
}

func TestQueryCancelsWhenContextEnds(t *testing.T) {
	var cancelled atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/2.0/sql/statements/":
			writeJSON(w, 200, state("s9", "RUNNING"))
		case r.Method == http.MethodGet && r.URL.Path == "/api/2.0/sql/statements/s9":
			writeJSON(w, 200, state("s9", "RUNNING"))
		case r.Method == http.MethodPost && r.URL.Path == "/api/2.0/sql/statements/s9/cancel":
			cancelled.Store(true)
			writeJSON(w, 200, map[string]any{})
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	ctx, stop := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer stop()
	d := &Databricks{Host: srv.URL, Warehouse: "wh", Token: "t"}
	_, err := d.Query(ctx, "SELECT 1")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err %v", err)
	}
	if !cancelled.Load() {
		t.Error("statement not cancelled")
	}
}

func TestQueryFollowsChunks(t *testing.T) {
	cols := [][2]string{{"filiale", "STRING"}, {"betrag", "DECIMAL"}}
	var chunks atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost:
			writeJSON(w, 200, result(cols, [][]any{{"Bern", "1.5"}, {"Basel", "2"}},
				"/api/2.0/sql/statements/s1/result/chunks/1?row_offset=2"))
		case r.URL.Path == "/api/2.0/sql/statements/s1/result/chunks/1":
			chunks.Add(1)
			if r.URL.Query().Get("row_offset") != "2" {
				t.Errorf("query of chunk link lost: %s", r.URL)
			}
			if r.Header.Get("Authorization") != "Bearer t" {
				t.Errorf("chunk without token")
			}
			writeJSON(w, 200, map[string]any{"chunk_index": 1, "row_offset": 2, "row_count": 1,
				"data_array": [][]any{{"Chur", "3.25"}}, "next_chunk_index": 2,
				"next_chunk_internal_link": "/api/2.0/sql/statements/s1/result/chunks/2?row_offset=3"})
		case r.URL.Path == "/api/2.0/sql/statements/s1/result/chunks/2":
			chunks.Add(1)
			writeJSON(w, 200, map[string]any{"chunk_index": 2, "row_offset": 3, "row_count": 1,
				"data_array": [][]any{{nil, "4"}}})
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL)
		}
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Token: "t"}
	rows, err := d.Query(context.Background(), "SELECT filiale, betrag FROM gold.x")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	var sum float64
	for _, r := range rows {
		got = append(got, adapter.String(r, "filiale"))
		f, _ := adapter.Float(r, "betrag")
		sum += f
	}
	if strings.Join(got, ",") != "Bern,Basel,Chur," || sum != 10.75 {
		t.Fatalf("rows %v", rows)
	}
	if rows[3]["filiale"] != nil {
		t.Errorf("null became %#v", rows[3]["filiale"])
	}
	if chunks.Load() != 2 {
		t.Errorf("%d chunk requests, want 2", chunks.Load())
	}
}

func TestQueryReportsFailedStatement(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{
			"statement_id": "s1",
			"status": map[string]any{"state": "FAILED", "error": map[string]any{
				"error_code": "BAD_REQUEST",
				"message":    "[TABLE_OR_VIEW_NOT_FOUND] The table or view `gold`.`fehlt` cannot be found.",
			}},
		})
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Token: "t"}
	_, err := d.Query(context.Background(), "SELECT * FROM gold.fehlt")
	want := "Die Abfrage ist in Databricks fehlgeschlagen: [TABLE_OR_VIEW_NOT_FOUND] The table or view `gold`.`fehlt` cannot be found."
	if err == nil || err.Error() != want {
		t.Fatalf("err %v", err)
	}
}

func TestQueryReportsHTTPErrors(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		want   string
	}{
		{401, `{"error_code":"UNAUTHENTICATED","message":"Invalid access token."}`, "Databricks lehnt die Anmeldung ab: Invalid access token."},
		{403, `{"error_code":"PERMISSION_DENIED","message":"User is not allowed to use warehouse wh."}`, "Databricks lehnt die Anmeldung ab: User is not allowed to use warehouse wh."},
		{400, `{"error_code":"INVALID_PARAMETER_VALUE","message":"wait_timeout must be 0s or between 5s and 50s"}`, "databricks: wait_timeout must be 0s or between 5s and 50s"},
		{502, "  <html>Bad Gateway</html>\n", "databricks: 502 Bad Gateway: <html>Bad Gateway</html>"},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			io.WriteString(w, tc.body)
		}))
		d := &Databricks{Host: srv.URL, Warehouse: "wh", Token: "t"}
		_, err := d.Query(context.Background(), "SELECT 1")
		if err == nil || err.Error() != tc.want {
			t.Errorf("%d: err %v, want %q", tc.status, err, tc.want)
		}
		srv.Close()
	}
}

func TestQueryRefusesWritesWithoutRequest(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		writeJSON(w, 200, result(one, nil, ""))
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Token: "t"}
	for _, sql := range []string{
		"DELETE FROM gold.kunden",
		"SELECT 1; DROP TABLE gold.kunden",
		"INSERT INTO gold.kunden SELECT * FROM x",
		"MERGE INTO gold.kunden USING x ON true WHEN MATCHED THEN DELETE",
	} {
		_, err := d.Query(context.Background(), sql)
		if err == nil || err.Error() != "Lumantic schickt Databricks nur lesende Abfragen." {
			t.Errorf("%q: err %v", sql, err)
		}
	}
	if hits.Load() != 0 {
		t.Errorf("%d requests sent", hits.Load())
	}
}

func TestOAuthTokenIsFetchedOnceAndCached(t *testing.T) {
	var fetches, queries atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oidc/v1/token":
			fetches.Add(1)
			if r.Method != http.MethodPost {
				t.Errorf("token method %s", r.Method)
			}
			if id, secret, ok := r.BasicAuth(); !ok || id != "sp-id" || secret != "sp-secret" {
				t.Errorf("basic auth %q %q %v", id, secret, ok)
			}
			if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
				t.Errorf("token Content-Type %q", ct)
			}
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			if r.PostForm.Get("grant_type") != "client_credentials" || r.PostForm.Get("scope") != "all-apis" {
				t.Errorf("token form %v", r.PostForm)
			}
			writeJSON(w, 200, map[string]any{"access_token": "eyJ-oauth", "token_type": "Bearer", "expires_in": 3600, "scope": "all-apis"})
		case "/api/2.0/sql/statements/":
			queries.Add(1)
			if got := r.Header.Get("Authorization"); got != "Bearer eyJ-oauth" {
				t.Errorf("Authorization %q", got)
			}
			writeJSON(w, 200, result(one, [][]any{{"1"}}, ""))
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Auth: "oauth", ClientID: "sp-id", ClientSecret: "sp-secret"}
	for range 2 {
		if _, err := d.Query(context.Background(), "SELECT 1 AS n"); err != nil {
			t.Fatal(err)
		}
	}
	if fetches.Load() != 1 || queries.Load() != 2 {
		t.Errorf("%d token fetches and %d queries, want 1 and 2", fetches.Load(), queries.Load())
	}
}

func TestOAuthRejectedClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 401, map[string]any{"error": "invalid_client", "error_description": "Client authentication failed"})
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Auth: "oauth", ClientID: "sp-id", ClientSecret: "falsch"}
	_, err := d.Query(context.Background(), "SELECT 1")
	if err == nil || err.Error() != "Databricks lehnt die Anmeldung ab: Client authentication failed" {
		t.Fatalf("err %v", err)
	}
}

func TestMissingCredentialsAreNamed(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer srv.Close()

	for _, tc := range []struct {
		d    *Databricks
		want string
	}{
		{&Databricks{Host: srv.URL, Warehouse: "wh"}, "Für Databricks fehlt der Token."},
		{&Databricks{Host: srv.URL, Warehouse: "wh", Auth: "token"}, "Für Databricks fehlt der Token."},
		{&Databricks{Host: srv.URL, Warehouse: "wh", Auth: "oauth", ClientID: "id"}, "Für die OAuth-Anmeldung bei Databricks fehlt das Client-Secret."},
		{&Databricks{Host: srv.URL, Warehouse: "wh", Auth: "oauth", ClientSecret: "s"}, "Für die OAuth-Anmeldung bei Databricks fehlt die Client-ID."},
		{&Databricks{Host: srv.URL, Warehouse: "wh", Auth: "OAuth"}, "Für die OAuth-Anmeldung bei Databricks fehlen die Client-ID und das Client-Secret."},
		{&Databricks{Host: srv.URL, Token: "t"}, "Für Databricks fehlt die ID des SQL-Warehouse."},
		{&Databricks{Warehouse: "wh", Token: "t"}, "Für Databricks fehlt die Adresse des Workspace."},
	} {
		_, err := tc.d.Query(context.Background(), "SELECT 1")
		if err == nil || err.Error() != tc.want {
			t.Errorf("err %v, want %q", err, tc.want)
		}
	}
	if hits.Load() != 0 {
		t.Errorf("%d requests sent", hits.Load())
	}
}

func TestHostIsNormalised(t *testing.T) {
	for host, want := range map[string]string{
		"https://adb-1234567890123456.7.azuredatabricks.net":  "https://adb-1234567890123456.7.azuredatabricks.net",
		"https://adb-1234567890123456.7.azuredatabricks.net/": "https://adb-1234567890123456.7.azuredatabricks.net",
		"adb-1234567890123456.7.azuredatabricks.net":          "https://adb-1234567890123456.7.azuredatabricks.net",
		" adb-1234567890123456.7.azuredatabricks.net// ":      "https://adb-1234567890123456.7.azuredatabricks.net",
		"http://127.0.0.1:8080/":                              "http://127.0.0.1:8080",
	} {
		if got := (&Databricks{Host: host}).base(); got != want {
			t.Errorf("%q: %q, want %q", host, got, want)
		}
	}
}

func TestDescribe(t *testing.T) {
	strs := func(names ...string) [][2]string {
		cols := make([][2]string, len(names))
		for i, n := range names {
			cols[i] = [2]string{n, "STRING"}
		}
		return cols
	}
	var describeSQL, valuesSQL string
	var catalogs []any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := statementBody(t, r)
		catalogs = append(catalogs, body["catalog"])
		sql, _ := body["statement"].(string)
		switch {
		case strings.Contains(sql, "information_schema"):
			describeSQL = sql
			writeJSON(w, 200, result(
				strs("schema_name", "table_name", "table_comment", "column_name", "data_type", "column_comment"),
				[][]any{
					{"gold", "kredite", "Kreditvolumen pro Monat", "monat", "DATE", "Monatsende"},
					{"gold", "kredite", "Kreditvolumen pro Monat", "segment", "STRING", nil},
					{"gold", "kredite", "Kreditvolumen pro Monat", "volumen_chf", "DECIMAL", "Volumen in CHF"},
					{"gold_filialen", "kunden", nil, "stichtag", "TIMESTAMP_NTZ", nil},
					{"gold_filialen", "kunden", nil, "filiale", "STRING", "Filiale"},
					{"gold_filialen", "kunden", nil, "anzahl", "LONG", nil},
					{"gold_filialen", "kunden", nil, "rohdaten", "BINARY", nil},
				}, ""))
		case strings.Contains(sql, "AS v FROM"):
			valuesSQL = sql
			writeJSON(w, 200, result(strs("t", "c", "v"), [][]any{
				{"gold.kredite", "segment", "Firmen"},
				{"gold.kredite", "segment", "Privat"},
				{"gold_filialen.kunden", "filiale", "Bern"},
				{"gold_filialen.kunden", "filiale", "Zürich"},
			}, ""))
		default:
			t.Errorf("unexpected statement %s", sql)
			writeJSON(w, 400, map[string]any{"message": "unexpected"})
		}
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Catalog: "bank", Schema: "Gold", Source: "Goldlayer Databricks", Token: "t"}
	cat, err := d.Describe(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{
		"FROM `bank`.information_schema.columns c",
		"JOIN `bank`.information_schema.tables t",
		"lower(c.table_schema) LIKE 'gold%'",
		"lower(c.table_schema) <> 'information_schema'",
		"ORDER BY c.table_schema, c.table_name, c.ordinal_position",
		"AS schema_name", "AS table_name", "AS table_comment", "AS column_name", "AS data_type", "AS column_comment",
	} {
		if !strings.Contains(describeSQL, want) {
			t.Errorf("describe SQL lacks %q:\n%s", want, describeSQL)
		}
	}
	if !strings.Contains(valuesSQL, "FROM `gold`.`kredite`") || !strings.Contains(valuesSQL, "CAST(`filiale` AS STRING)") {
		t.Errorf("values SQL not in Databricks dialect:\n%s", valuesSQL)
	}
	if len(catalogs) != 2 || catalogs[0] != "bank" || catalogs[1] != "bank" {
		t.Errorf("catalog sent per statement: %v", catalogs)
	}

	if cat.Source != "Goldlayer Databricks" || cat.Dialect != "databricks" {
		t.Errorf("source %q dialect %q", cat.Source, cat.Dialect)
	}
	var names []string
	for _, tb := range cat.Tables {
		names = append(names, tb.Name)
	}
	if strings.Join(names, ",") != "gold.kredite,gold_filialen.kunden" {
		t.Fatalf("tables %v", names)
	}
	kre := cat.Table("gold.kredite")
	if kre.Desc != "Kreditvolumen pro Monat" {
		t.Errorf("table comment %q", kre.Desc)
	}
	roles := map[string]string{}
	for _, tb := range cat.Tables {
		for _, c := range tb.Columns {
			roles[tb.Name+"."+c.Name] = c.Role
		}
	}
	for col, want := range map[string]string{
		"gold.kredite.monat":            catalog.RoleTime,
		"gold.kredite.segment":          catalog.RoleDimension,
		"gold.kredite.volumen_chf":      catalog.RoleMeasure,
		"gold_filialen.kunden.stichtag": catalog.RoleTime,
		"gold_filialen.kunden.filiale":  catalog.RoleDimension,
		"gold_filialen.kunden.anzahl":   catalog.RoleMeasure,
		"gold_filialen.kunden.rohdaten": "",
	} {
		if roles[col] != want {
			t.Errorf("role of %s = %q, want %q", col, roles[col], want)
		}
	}
	if c := kre.Column("volumen_chf"); c.Unit != "CHF" || c.Desc != "Volumen in CHF" || c.Type != "DECIMAL" {
		t.Errorf("volumen_chf %+v", c)
	}
	if c := kre.Column("segment"); strings.Join(c.Values, ",") != "Firmen,Privat" {
		t.Errorf("segment values %v", c.Values)
	}
	if c := cat.Table("gold_filialen.kunden").Column("filiale"); strings.Join(c.Values, ",") != "Bern,Zürich" {
		t.Errorf("filiale values %v", c.Values)
	}
	if tc := cat.Table("gold_filialen.kunden").TimeColumn(); tc == nil || tc.Name != "stichtag" {
		t.Errorf("time column %+v", tc)
	}
}

func TestDescribeWithoutCatalogOrSchema(t *testing.T) {
	var sqls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := statementBody(t, r)
		if _, ok := body["catalog"]; ok {
			t.Errorf("catalog sent although empty")
		}
		sqls = append(sqls, body["statement"].(string))
		writeJSON(w, 200, result([][2]string{{"schema_name", "STRING"}}, nil, ""))
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Token: "t"}
	cat, err := d.Describe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.Tables) != 0 || len(sqls) != 1 {
		t.Fatalf("tables %v, statements %d", cat.Tables, len(sqls))
	}
	if !strings.Contains(sqls[0], "FROM information_schema.columns c") || strings.Contains(sqls[0], "LIKE") {
		t.Errorf("describe SQL:\n%s", sqls[0])
	}
}

func TestSchemaPrefixIsEscaped(t *testing.T) {
	var sql string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sql = statementBody(t, r)["statement"].(string)
		writeJSON(w, 200, result([][2]string{{"schema_name", "STRING"}}, nil, ""))
	}))
	defer srv.Close()

	d := &Databricks{Host: srv.URL, Warehouse: "wh", Schema: `Gold_x'%`, Token: "t"}
	if _, err := d.Describe(context.Background()); err != nil {
		t.Fatal(err)
	}
	// _ and % match literally (LIKE escape \, doubled inside the literal),
	// the quote is escaped Databricks-style.
	if want := `LIKE 'gold\\_x\'\\%%'`; !strings.Contains(sql, want) {
		t.Errorf("describe SQL lacks %s:\n%s", want, sql)
	}
}
