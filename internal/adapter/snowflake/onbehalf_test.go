package snowflake

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lumantic/internal/adapter"
)

// In the person's name, Snowflake gets their login token as an OAuth token and
// no role of Lumantic's own.
func TestAsSendsThePersonsToken(t *testing.T) {
	var auth, kind string
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth, kind = r.Header.Get("Authorization"), r.Header.Get("X-Snowflake-Authorization-Token-Type")
		json.NewDecoder(r.Body).Decode(&body)
		w.Write([]byte(`{"resultSetMetaData":{"numRows":1,"format":"jsonv2","rowType":[{"name":"P","type":"text"}],"partitionInfo":[{"rowCount":1}]},"data":[["2026-10"]],"statementHandle":"h1"}`))
	}))
	defer srv.Close()
	tech := &Snowflake{Account: "org-acc", User: "LUMANTIC", Role: "LUMANTIC_READER", Warehouse: "WH", Database: "GOLD", Auth: "keypair", KeyFile: "gibt-es-nicht.p8", BaseURL: srv.URL}
	as, err := tech.As(context.Background(), adapter.Person{ID: "mmuster", Token: "eyJ.person.token"})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := as.Query(context.Background(), "SELECT 1")
	if err != nil || adapter.String(rows[0], "p") != "2026-10" {
		t.Fatalf("%v %v", rows, err)
	}
	if auth != "Bearer eyJ.person.token" || kind != "OAUTH" {
		t.Errorf("headers: %q %q", auth, kind)
	}
	if _, ok := body["role"]; ok || body["warehouse"] != "WH" || body["database"] != "GOLD" {
		t.Errorf("body: %v", body)
	}
	if _, err := tech.As(context.Background(), adapter.Person{ID: "mmuster"}); err == nil || !strings.Contains(err.Error(), "Token deiner Anmeldung") {
		t.Errorf("without a token: %v", err)
	}
}
