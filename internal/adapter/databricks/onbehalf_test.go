package databricks

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/Dominik1407/lumantic/internal/adapter"
)

// In the person's name, Databricks gets a token traded for their login token
// (token federation), once per login token.
func TestAsTradesThePersonsToken(t *testing.T) {
	var trades atomic.Int32
	var bearer string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oidc/v1/token":
			r.ParseForm()
			if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:token-exchange" || r.Form.Get("subject_token_type") != "urn:ietf:params:oauth:token-type:jwt" ||
				r.Form.Get("scope") != "all-apis" || r.Header.Get("Authorization") != "" {
				w.WriteHeader(400)
				w.Write([]byte(`{"error":"invalid_request","error_description":"bad exchange"}`))
				return
			}
			if r.Form.Get("subject_token") != "eyJ.person.token" {
				w.WriteHeader(401)
				w.Write([]byte(`{"error":"invalid_grant","error_description":"no federation policy trusts this issuer"}`))
				return
			}
			trades.Add(1)
			w.Write([]byte(`{"access_token":"dbx-for-mmuster","token_type":"Bearer","expires_in":3600}`))
		default:
			bearer = r.Header.Get("Authorization")
			w.Write([]byte(`{"statement_id":"s1","status":{"state":"SUCCEEDED"},"manifest":{"schema":{"columns":[{"name":"p","type_name":"STRING","position":0}]}},"result":{"data_array":[["2026-10"]]}}`))
		}
	}))
	defer srv.Close()
	tech := &Databricks{Host: srv.URL, Warehouse: "wh", Catalog: "bank", Auth: "oauth", ClientID: "sp", ClientSecret: "geheim"}
	for i := 0; i < 2; i++ {
		as, err := tech.As(context.Background(), adapter.Person{ID: "mmuster", Token: "eyJ.person.token"})
		if err != nil {
			t.Fatal(err)
		}
		rows, err := as.Query(context.Background(), "SELECT 1")
		if err != nil || adapter.String(rows[0], "p") != "2026-10" {
			t.Fatalf("%v %v", rows, err)
		}
	}
	if bearer != "Bearer dbx-for-mmuster" || trades.Load() != 1 {
		t.Errorf("bearer %q, trades %d", bearer, trades.Load())
	}
	if _, err := tech.As(context.Background(), adapter.Person{ID: "x", Token: "eyJ.fremd"}); err == nil || !strings.Contains(err.Error(), "Anmeldung") {
		t.Errorf("an untrusted login: %v", err)
	}
	if _, err := tech.As(context.Background(), adapter.Person{ID: "x"}); err == nil {
		t.Error("without a token")
	}
}
