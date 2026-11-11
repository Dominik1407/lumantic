package snowflake

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"lumantic/internal/adapter"
	"lumantic/internal/catalog"
)

// seen is one request the fake SQL API received.
type seen struct {
	Method, Path, Query string
	Header              http.Header
	Body                map[string]any
}

func (r seen) statement() string { s, _ := r.Body["statement"].(string); return s }

// fakeAPI stands in for the SQL API: answer decides each reply, and every
// request is recorded.
type fakeAPI struct {
	*httptest.Server
	mu   sync.Mutex
	reqs []seen
}

func newFake(t *testing.T, answer func(w http.ResponseWriter, r seen)) *fakeAPI {
	t.Helper()
	f := &fakeAPI{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := seen{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery, Header: r.Header.Clone()}
		if b, _ := io.ReadAll(r.Body); len(b) > 0 {
			if err := json.Unmarshal(b, &s.Body); err != nil {
				t.Errorf("request body is not JSON: %s", b)
			}
		}
		f.mu.Lock()
		f.reqs = append(f.reqs, s)
		f.mu.Unlock()
		answer(w, s)
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeAPI) requests() []seen {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]seen(nil), f.reqs...)
}

func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// resultSet builds a 200 answer. Columns are "NAME:type"; parts is the number
// of partitions the metadata announces.
func resultSet(cols []string, data [][]any, parts int) map[string]any {
	rowType := []map[string]any{}
	for _, c := range cols {
		name, typ, _ := strings.Cut(c, ":")
		rowType = append(rowType, map[string]any{"name": name, "type": typ, "scale": 0, "precision": 38, "nullable": true})
	}
	info := []map[string]any{}
	for range max(parts, 1) {
		info = append(info, map[string]any{"rowCount": len(data), "uncompressedSize": 1000})
	}
	return map[string]any{
		"resultSetMetaData": map[string]any{"numRows": len(data), "format": "jsonv2", "rowType": rowType, "partitionInfo": info},
		"data":              data,
		"code":              "090001",
		"statementHandle":   "h-1",
		"message":           "Statement executed successfully.",
	}
}

func accepted(handle string) map[string]any {
	return map[string]any{
		"code":               "333334",
		"message":            "Asynchronous execution in progress. Use provided query id to perform query monitoring and management.",
		"statementHandle":    handle,
		"statementStatusUrl": "/api/v2/statements/" + handle,
	}
}

func tokenAdapter(base string) *Snowflake {
	return &Snowflake{
		Account: "myorg-myaccount", User: "LUMANTIC", Warehouse: "WH_LUMANTIC", Database: "ANALYTICS",
		Auth: "token", Token: "pat-secret", BaseURL: base,
	}
}

var testKey = sync.OnceValue(func() *rsa.PrivateKey {
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(err)
	}
	return k
})

// writeKey stores the test key as PKCS#8 ("PRIVATE KEY") or PKCS#1 ("RSA
// PRIVATE KEY") and returns the path.
func writeKey(t *testing.T, pkcs1 bool) string {
	t.Helper()
	block := &pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(testKey())}
	if !pkcs1 {
		der, err := x509.MarshalPKCS8PrivateKey(testKey())
		if err != nil {
			t.Fatal(err)
		}
		block = &pem.Block{Type: "PRIVATE KEY", Bytes: der}
	}
	path := filepath.Join(t.TempDir(), "lumantic.p8")
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// verifyJWT checks the token's form and signature and returns its claims.
func verifyJWT(t *testing.T, tok string) map[string]any {
	t.Helper()
	parts := strings.Split(tok, ".")
	if len(parts) != 3 || strings.Contains(tok, "=") {
		t.Fatalf("not a compact JWT without padding: %q", tok)
	}
	dec := func(s string) []byte {
		b, err := base64.RawURLEncoding.DecodeString(s)
		if err != nil {
			t.Fatalf("not base64url: %q", s)
		}
		return b
	}
	var header, claims map[string]any
	json.Unmarshal(dec(parts[0]), &header)
	json.Unmarshal(dec(parts[1]), &claims)
	if header["alg"] != "RS256" || header["typ"] != "JWT" {
		t.Fatalf("header %v", header)
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(&testKey().PublicKey, crypto.SHA256, digest[:], dec(parts[2])); err != nil {
		t.Fatalf("signature does not verify: %v", err)
	}
	return claims
}

func fingerprint(t *testing.T) string {
	der, err := x509.MarshalPKIXPublicKey(&testKey().PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(der)
	return "SHA256:" + base64.StdEncoding.EncodeToString(sum[:])
}

func TestNameAndDialect(t *testing.T) {
	s := &Snowflake{}
	if s.Name() != "snowflake" || s.Dialect() != "snowflake" || adapter.DialectOf(s).Name != "snowflake" {
		t.Fatalf("name %q dialect %q", s.Name(), s.Dialect())
	}
}

func TestQuerySendsHeadersAndBody(t *testing.T) {
	f := newFake(t, func(w http.ResponseWriter, r seen) {
		reply(w, 200, resultSet([]string{"N:fixed"}, [][]any{{"1"}}, 1))
	})
	s := tokenAdapter(f.URL + "/")
	s.Role = "LUMANTIC_READ"
	sql := "SELECT count(*) AS n FROM \"GOLD\".\"FILIALEN\""
	if _, err := s.Query(context.Background(), sql); err != nil {
		t.Fatal(err)
	}
	reqs := f.requests()
	if len(reqs) != 1 {
		t.Fatalf("%d requests", len(reqs))
	}
	r := reqs[0]
	if r.Method != http.MethodPost || r.Path != "/api/v2/statements" {
		t.Fatalf("%s %s", r.Method, r.Path)
	}
	for k, want := range map[string]string{
		"Authorization":                        "Bearer pat-secret",
		"X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
		"Content-Type":                         "application/json",
		"Accept":                               "application/json",
		"User-Agent":                           "lumantic",
	} {
		if got := r.Header.Get(k); got != want {
			t.Errorf("header %s = %q, want %q", k, got, want)
		}
	}
	want := map[string]any{"statement": sql, "timeout": 120.0, "warehouse": "WH_LUMANTIC", "database": "ANALYTICS", "role": "LUMANTIC_READ"}
	if !reflect.DeepEqual(r.Body, want) {
		t.Fatalf("body %v", r.Body)
	}

	// OAuth token, no role: the role stays out of the body.
	s.Role, s.TokenType, s.Token = "", "oauth", "oauth-token"
	if _, err := s.Query(context.Background(), "SELECT 1 AS n"); err != nil {
		t.Fatal(err)
	}
	r = f.requests()[1]
	if r.Header.Get("X-Snowflake-Authorization-Token-Type") != "OAUTH" || r.Header.Get("Authorization") != "Bearer oauth-token" {
		t.Fatalf("headers %v", r.Header)
	}
	if _, ok := r.Body["role"]; ok {
		t.Fatalf("role sent although empty: %v", r.Body)
	}
}

func TestKeypairJWT(t *testing.T) {
	now := time.Date(2026, 11, 11, 9, 30, 0, 0, time.UTC)
	for _, tc := range []struct{ account, user, who string }{
		{"xy12345.eu-central-1", "lumantic_svc", "XY12345.LUMANTIC_SVC"},
		{"myorg-myaccount", "Lumantic", "MYORG-MYACCOUNT.LUMANTIC"},
	} {
		t.Run(tc.account, func(t *testing.T) {
			f := newFake(t, func(w http.ResponseWriter, r seen) {
				reply(w, 200, resultSet([]string{"N:fixed"}, [][]any{{"1"}}, 1))
			})
			s := &Snowflake{Account: tc.account, User: tc.user, Auth: "keypair", KeyFile: writeKey(t, false),
				BaseURL: f.URL, now: func() time.Time { return now }}
			if _, err := s.Query(context.Background(), "SELECT 1 AS n"); err != nil {
				t.Fatal(err)
			}
			r := f.requests()[0]
			if r.Header.Get("X-Snowflake-Authorization-Token-Type") != "KEYPAIR_JWT" {
				t.Fatalf("token type %q", r.Header.Get("X-Snowflake-Authorization-Token-Type"))
			}
			tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok {
				t.Fatalf("authorization %q", r.Header.Get("Authorization"))
			}
			c := verifyJWT(t, tok)
			if c["iss"] != tc.who+"."+fingerprint(t) || c["sub"] != tc.who {
				t.Fatalf("iss %v sub %v", c["iss"], c["sub"])
			}
			if c["iat"] != float64(now.Unix()) || c["exp"] != float64(now.Add(59*time.Minute).Unix()) {
				t.Fatalf("iat %v exp %v", c["iat"], c["exp"])
			}
		})
	}

	t.Run("pkcs1", func(t *testing.T) {
		s := &Snowflake{Account: "myorg-myaccount", User: "lumantic", Auth: "keypair", KeyFile: writeKey(t, true)}
		tok, err := s.keypairJWT()
		if err != nil {
			t.Fatal(err)
		}
		if c := verifyJWT(t, tok); c["sub"] != "MYORG-MYACCOUNT.LUMANTIC" {
			t.Fatalf("sub %v", c["sub"])
		}
	})
}

func TestJWTIsCachedAndRenewed(t *testing.T) {
	t0 := time.Date(2026, 11, 11, 8, 0, 0, 0, time.UTC)
	var mu sync.Mutex
	clock := t0
	s := &Snowflake{Account: "myorg-myaccount", User: "lumantic", Auth: "keypair", KeyFile: writeKey(t, false),
		now: func() time.Time { mu.Lock(); defer mu.Unlock(); return clock }}
	turn := func(d time.Duration) { mu.Lock(); clock = t0.Add(d); mu.Unlock() }

	first, err := s.keypairJWT()
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	toks := make([]string, 8)
	turn(30 * time.Minute)
	for i := range toks {
		wg.Add(1)
		go func() { defer wg.Done(); toks[i], _ = s.keypairJWT() }()
	}
	wg.Wait()
	for _, tok := range toks {
		if tok != first {
			t.Fatal("JWT not reused within its lifetime")
		}
	}
	turn(54 * time.Minute) // five minutes before it expires
	renewed, err := s.keypairJWT()
	if err != nil {
		t.Fatal(err)
	}
	if renewed == first {
		t.Fatal("JWT not renewed five minutes before expiry")
	}
	if c := verifyJWT(t, renewed); c["iat"] != float64(t0.Add(54*time.Minute).Unix()) {
		t.Fatalf("renewed iat %v", c["iat"])
	}
}

func TestSignInProblemsSendNothing(t *testing.T) {
	f := newFake(t, func(w http.ResponseWriter, r seen) { reply(w, 200, resultSet(nil, nil, 1)) })
	dir := t.TempDir()
	missing := filepath.Join(dir, "fehlt.p8")
	encrypted := filepath.Join(dir, "encrypted.p8")
	os.WriteFile(encrypted, pem.EncodeToMemory(&pem.Block{Type: "ENCRYPTED PRIVATE KEY", Bytes: []byte("not really")}), 0o600)
	legacy := filepath.Join(dir, "legacy.pem")
	os.WriteFile(legacy, pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Headers: map[string]string{"Proc-Type": "4,ENCRYPTED", "DEK-Info": "AES-256-CBC,00"}, Bytes: []byte("x")}), 0o600)

	for _, tc := range []struct {
		name string
		s    *Snowflake
		want string
	}{
		{"missing key file", &Snowflake{Account: "a", User: "u", Auth: "keypair", KeyFile: missing}, "Die Schlüsseldatei " + missing + " gibt es nicht."},
		{"encrypted pkcs8", &Snowflake{Account: "a", User: "u", Auth: "keypair", KeyFile: encrypted}, "unverschlüsselt (PKCS#8)"},
		{"encrypted pkcs1", &Snowflake{Account: "a", User: "u", Auth: "keypair", KeyFile: legacy}, "unverschlüsselt (PKCS#8)"},
		{"no token", &Snowflake{Auth: "token"}, "fehlt das Snowflake-Token"},
		{"unknown token type", &Snowflake{Auth: "token", Token: "x", TokenType: "basic"}, "Token-Typ"},
		{"unknown auth", &Snowflake{Auth: "password"}, "«keypair» oder «token»"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.s.BaseURL = f.URL
			_, err := tc.s.Query(context.Background(), "SELECT 1")
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err %v, want %q", err, tc.want)
			}
		})
	}
	if n := len(f.requests()); n != 0 {
		t.Fatalf("%d requests sent", n)
	}
}

func TestPollsUntilDone(t *testing.T) {
	polls := 0
	f := newFake(t, func(w http.ResponseWriter, r seen) {
		switch {
		case r.Method == http.MethodPost:
			reply(w, 202, accepted("h-1"))
		case polls < 1:
			polls++
			reply(w, 202, accepted("h-1"))
		default:
			reply(w, 200, resultSet([]string{"P:text", "C0:real"}, [][]any{{"2026-01", "10.5"}, {"2026-02", "11"}}, 1))
		}
	})
	rows, err := tokenAdapter(f.URL).Query(context.Background(), "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	reqs := f.requests()
	if len(reqs) != 3 {
		t.Fatalf("%d requests", len(reqs))
	}
	for _, r := range reqs[1:] {
		if r.Method != http.MethodGet || r.Path != "/api/v2/statements/h-1" || r.Query != "" {
			t.Fatalf("poll %s %s?%s", r.Method, r.Path, r.Query)
		}
	}
	if len(rows) != 2 || adapter.String(rows[1], "p") != "2026-02" {
		t.Fatalf("rows %v", rows)
	}
}

func TestFetchesFurtherPartitions(t *testing.T) {
	f := newFake(t, func(w http.ResponseWriter, r seen) {
		switch {
		case r.Method == http.MethodPost:
			reply(w, 200, resultSet([]string{"P:text", "C0:fixed"}, [][]any{{"2026-01", "1"}, {"2026-02", "2"}}, 2))
		case r.Path == "/api/v2/statements/h-1" && r.Query == "partition=1":
			// Later partitions carry only data and may come gzip-packed.
			var buf bytes.Buffer
			zw := gzip.NewWriter(&buf)
			json.NewEncoder(zw).Encode(map[string]any{"data": [][]any{{"2026-03", "3"}}})
			zw.Close()
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Write(buf.Bytes())
		default:
			reply(w, 404, map[string]any{"message": "no such partition"})
		}
	})
	rows, err := tokenAdapter(f.URL).Query(context.Background(), "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, r := range rows {
		c0, _ := adapter.Float(r, "c0")
		got = append(got, fmt.Sprintf("%s=%g", adapter.String(r, "p"), c0))
	}
	if strings.Join(got, ",") != "2026-01=1,2026-02=2,2026-03=3" {
		t.Fatalf("rows %v", got)
	}
	if n := len(f.requests()); n != 2 {
		t.Fatalf("%d requests", n)
	}
}

func TestConvertsTypes(t *testing.T) {
	cols := []string{"N:fixed", "AMOUNT:fixed", "R:real", "DAY:date", "NTZ:timestamp_ntz", "LTZ:TIMESTAMP_LTZ",
		"TZ:timestamp_tz", "TZ_NANOS:timestamp_tz", "NAME:text", "OK:boolean", "NOTHING:text", "OLD:date"}
	data := [][]any{{"42", "12.50", "0.25", "19723", "1704112496.123456789", "-0.500000000",
		"1704112496.000000000 1500", "1616173619000000000 960", "Zürich", "true", nil, "-1"}}
	f := newFake(t, func(w http.ResponseWriter, r seen) { reply(w, 200, resultSet(cols, data, 1)) })
	rows, err := tokenAdapter(f.URL).Query(context.Background(), "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows %v", rows)
	}
	r := rows[0]
	for k, want := range map[string]any{
		"n": 42.0, "amount": 12.5, "r": 0.25,
		"day": "2024-01-01", "old": "1969-12-31",
		"ntz": "2024-01-01T12:34:56", "ltz": "1969-12-31T23:59:59",
		"tz": "2024-01-01T12:34:56", "tz_nanos": "2021-03-19T17:06:59",
		"name": "Zürich", "ok": "true",
	} {
		if got := r[k]; got != want {
			t.Errorf("%s = %#v, want %#v", k, got, want)
		}
	}
	if v, ok := r["nothing"]; !ok || v != nil {
		t.Errorf("null = %#v (present %v), want nil", v, ok)
	}
}

func TestUpperCaseAliases(t *testing.T) {
	cols := []string{"P:text", "s:text", "C0:real", "X:text", "x:text"}
	f := newFake(t, func(w http.ResponseWriter, r seen) {
		reply(w, 200, resultSet(cols, [][]any{{"2026-01", "Bern", "10.5", "upper", "lower"}}, 1))
	})
	rows, err := tokenAdapter(f.URL).Query(context.Background(), "SELECT 1")
	if err != nil {
		t.Fatal(err)
	}
	r := rows[0]
	if adapter.String(r, "p") != "2026-01" || adapter.String(r, "P") != "2026-01" || adapter.String(r, "s") != "Bern" {
		t.Fatalf("row %v", r)
	}
	if v, ok := adapter.Float(r, "c0"); !ok || v != 10.5 {
		t.Fatalf("c0 %v %v", v, ok)
	}
	// A column really named "x" keeps its own value.
	if adapter.String(r, "x") != "lower" || adapter.String(r, "X") != "upper" {
		t.Fatalf("x %q X %q", r["x"], r["X"])
	}
}

func TestErrorSentences(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		want   string
	}{
		{401, `{"code":"390303","message":"Invalid OAuth access token."}`, "Snowflake lehnt die Anmeldung ab: Invalid OAuth access token."},
		{403, `{"code":"390186","message":"Role LUMANTIC_READ is not granted."}`, "Snowflake lehnt die Anmeldung ab: Role LUMANTIC_READ is not granted."},
		{401, ``, "Snowflake lehnt die Anmeldung ab: 401 Unauthorized"},
		{422, `{"code":"002003","sqlState":"42S02","message":"SQL compilation error:\nObject 'GOLD.X' does not exist or not authorized.","statementHandle":"h-1"}`,
			"snowflake: SQL compilation error: Object 'GOLD.X' does not exist or not authorized."},
		{500, "boom\n", "snowflake: 500 Internal Server Error: boom"},
	} {
		f := newFake(t, func(w http.ResponseWriter, r seen) {
			w.WriteHeader(tc.status)
			io.WriteString(w, tc.body)
		})
		_, err := tokenAdapter(f.URL).Query(context.Background(), "SELECT 1")
		if err == nil || err.Error() != tc.want {
			t.Errorf("%d: err %v, want %q", tc.status, err, tc.want)
		}
	}
}

func TestRefusesWritesWithoutRequest(t *testing.T) {
	f := newFake(t, func(w http.ResponseWriter, r seen) { reply(w, 200, resultSet(nil, nil, 1)) })
	s := tokenAdapter(f.URL)
	for _, sql := range []string{"DELETE FROM GOLD.X", "SELECT 1; DROP TABLE GOLD.X", "CREATE TABLE X AS SELECT 1", "GRANT ROLE SYSADMIN TO USER LUMANTIC"} {
		_, err := s.Query(context.Background(), sql)
		if err == nil || err.Error() != "Lumantic schickt Snowflake nur lesende Abfragen." {
			t.Errorf("%s: err %v", sql, err)
		}
	}
	if n := len(f.requests()); n != 0 {
		t.Fatalf("%d requests sent", n)
	}
}

func TestDescribe(t *testing.T) {
	info := []string{"SCHEMA_NAME:text", "TABLE_NAME:text", "TABLE_COMMENT:text", "COLUMN_NAME:text", "DATA_TYPE:text", "COLUMN_COMMENT:text"}
	f := newFake(t, func(w http.ResponseWriter, r seen) {
		switch sql := r.statement(); {
		case strings.Contains(sql, "information_schema.columns"):
			reply(w, 200, resultSet(info, [][]any{
				{"GOLD", "FILIALEN", "Kennzahlen je Filiale", "MONAT", "DATE", nil},
				{"GOLD", "FILIALEN", "Kennzahlen je Filiale", "REGION", "TEXT", "Region der Filiale"},
				{"GOLD", "FILIALEN", "Kennzahlen je Filiale", "ERTRAG_CHF", "NUMBER", nil},
				{"GOLD", "FILIALEN", "Kennzahlen je Filiale", "ERFASST", "TIMESTAMP_NTZ", nil},
				{"GOLD_RISK", "LIMITEN", nil, "STICHTAG", "DATE", nil},
				{"GOLD_RISK", "LIMITEN", nil, "SEGMENT", "TEXT", nil},
				{"GOLD_RISK", "LIMITEN", nil, "LIMITE", "FLOAT", nil},
			}, 1))
		case strings.Contains(sql, "SELECT DISTINCT"):
			reply(w, 200, resultSet([]string{"T:text", "C:text", "V:text"}, [][]any{
				{"GOLD.FILIALEN", "REGION", "Bern"},
				{"GOLD.FILIALEN", "REGION", "Zürich"},
				{"GOLD_RISK.LIMITEN", "SEGMENT", "Firmen"},
			}, 1))
		default:
			reply(w, 422, map[string]any{"message": "unexpected statement"})
		}
	})
	s := tokenAdapter(f.URL)
	s.Schema, s.Source = "gold", "Gold in Snowflake"
	cat, err := s.Describe(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	reqs := f.requests()
	if len(reqs) != 2 {
		t.Fatalf("%d requests", len(reqs))
	}
	describe := reqs[0].statement()
	for _, part := range []string{"c.table_schema ILIKE 'gold%' ESCAPE '\\\\'", "<> 'INFORMATION_SCHEMA'", "ORDER BY c.table_schema, c.table_name, c.ordinal_position",
		"AS schema_name", "AS table_name", "AS table_comment", "AS column_name", "AS data_type", "AS column_comment"} {
		if !strings.Contains(describe, part) {
			t.Errorf("describe SQL lacks %q:\n%s", part, describe)
		}
	}
	if reqs[0].Body["database"] != "ANALYTICS" {
		t.Errorf("database %v", reqs[0].Body["database"])
	}
	if values := reqs[1].statement(); !strings.Contains(values, `FROM "GOLD"."FILIALEN"`) || !strings.Contains(values, `FROM "GOLD_RISK"."LIMITEN"`) {
		t.Errorf("values SQL:\n%s", values)
	}

	if cat.Source != "Gold in Snowflake" || cat.Dialect != "snowflake" {
		t.Fatalf("source %q dialect %q", cat.Source, cat.Dialect)
	}
	var names []string
	for _, tb := range cat.Tables {
		names = append(names, tb.Name)
	}
	if strings.Join(names, ",") != "GOLD.FILIALEN,GOLD_RISK.LIMITEN" {
		t.Fatalf("tables %v", names)
	}
	fil := cat.Table("GOLD.FILIALEN")
	if fil.Desc != "Kennzahlen je Filiale" {
		t.Errorf("table desc %q", fil.Desc)
	}
	for col, role := range map[string]string{"MONAT": catalog.RoleTime, "REGION": catalog.RoleDimension, "ERTRAG_CHF": catalog.RoleMeasure, "ERFASST": catalog.RoleTime} {
		if c := fil.Column(col); c == nil || c.Role != role {
			t.Errorf("%s: %+v, want role %s", col, c, role)
		}
	}
	if c := fil.Column("ERTRAG_CHF"); c.Unit != "CHF" {
		t.Errorf("unit %q", c.Unit)
	}
	if c := fil.Column("REGION"); c.Desc != "Region der Filiale" || strings.Join(c.Values, ",") != "Bern,Zürich" {
		t.Errorf("region %+v", c)
	}
	lim := cat.Table("GOLD_RISK.LIMITEN")
	if tc := lim.TimeColumn(); tc == nil || tc.Name != "STICHTAG" {
		t.Errorf("time column %+v", tc)
	}
	if c := lim.Column("LIMITE"); c.Role != catalog.RoleMeasure {
		t.Errorf("limite %+v", c)
	}
	if c := lim.Column("SEGMENT"); strings.Join(c.Values, ",") != "Firmen" {
		t.Errorf("segment %+v", c)
	}
}

func TestDescribeEscapesSchemaPrefix(t *testing.T) {
	sql := describeSQL(adapter.DialectFor("snowflake"), `gold_x'%`)
	if !strings.Contains(sql, `ILIKE 'gold\\_x''\\%%' ESCAPE '\\'`) {
		t.Fatalf("prefix not escaped:\n%s", sql)
	}
	if !adapter.ReadOnly(sql) {
		t.Fatal("describe SQL does not pass ReadOnly")
	}
	if all := describeSQL(adapter.DialectFor("snowflake"), ""); !strings.Contains(all, "ILIKE '%'") {
		t.Fatalf("empty prefix:\n%s", all)
	}
}

func TestCancelsWhenContextEnds(t *testing.T) {
	cancelled := make(chan string, 1)
	f := newFake(t, func(w http.ResponseWriter, r seen) {
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.Path, "/cancel"):
			cancelled <- r.Path
			reply(w, 200, map[string]any{"code": "000604", "message": "Statement cancelled."})
		case r.Method == http.MethodPost:
			reply(w, 202, accepted("h-9"))
		default:
			reply(w, 202, accepted("h-9"))
		}
	})
	ctx, stop := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer stop()
	_, err := tokenAdapter(f.URL).Query(ctx, "SELECT 1")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err %v", err)
	}
	select {
	case path := <-cancelled:
		if path != "/api/v2/statements/h-9/cancel" {
			t.Fatalf("cancel path %s", path)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("statement was not cancelled")
	}
}

func TestBaseURLFromAccount(t *testing.T) {
	for account, want := range map[string]string{
		"XY12345.eu-central-1": "https://xy12345.eu-central-1.snowflakecomputing.com",
		"myorg-my_account":     "https://myorg-my-account.snowflakecomputing.com",
	} {
		if got, err := (&Snowflake{Account: account}).base(); err != nil || got != want {
			t.Errorf("%s: %q %v", account, got, err)
		}
	}
	if _, err := (&Snowflake{}).base(); err == nil {
		t.Error("no error without account")
	}
}
