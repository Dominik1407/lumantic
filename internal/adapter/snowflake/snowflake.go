// Package snowflake reads a gold layer in Snowflake through its SQL REST API
// (v2). Lumantic only ever sends single read-only queries, so a small HTTP
// client does the job: no driver, no CGO.
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
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"lumantic/internal/adapter"
	"lumantic/internal/catalog"
)

var _ adapter.Adapter = (*Snowflake)(nil)

// Snowflake sends statements to the SQL API, signed in with a key pair (a JWT
// it signs itself) or with a token. The role should be read-only; Query
// refuses anything but a single query anyway.
type Snowflake struct {
	Account   string       // account identifier, e.g. "myorg-myaccount" or "xy12345.eu-central-1"
	User      string       // keypair: the user the public key belongs to
	Role      string       // optional; empty = the user's default role
	Warehouse string       // as Snowflake stores it, usually upper case
	Database  string       // as Snowflake stores it, usually upper case
	Schema    string       // schema prefix to expose, matched case-insensitively; "" = all but INFORMATION_SCHEMA
	Source    string       // human name of the gold layer
	Auth      string       // "keypair" or "token"
	KeyFile   string       // keypair: PEM file with an unencrypted RSA private key (PKCS#8 or PKCS#1)
	Token     string       // token: a programmatic access token or an OAuth access token
	TokenType string       // token: "PROGRAMMATIC_ACCESS_TOKEN" (default) or "OAUTH"
	BaseURL   string       // "" = https://<account>.snowflakecomputing.com
	Client    *http.Client // nil = a client with a 90 s timeout

	now func() time.Time // nil = time.Now; tests turn the clock

	mu     sync.Mutex // guards the cached JWT
	jwt    string
	jwtExp time.Time
}

const (
	statementTimeout = 120              // seconds Snowflake may spend on one statement
	jwtLifetime      = 59 * time.Minute // Snowflake accepts at most one hour
	jwtRenew         = 5 * time.Minute  // renew this long before the JWT expires
)

// The SQL API answers within about 45 s, with 202 if the statement still runs,
// so one request never needs longer than this.
var defaultClient = &http.Client{Timeout: 90 * time.Second}

func (s *Snowflake) Name() string    { return "snowflake" }
func (s *Snowflake) Dialect() string { return "snowflake" }

type statementRequest struct {
	Statement string `json:"statement"`
	Timeout   int    `json:"timeout"`
	// The SQL API reference calls these values case-sensitive, so they go out
	// exactly as configured.
	Warehouse string `json:"warehouse,omitempty"`
	Database  string `json:"database,omitempty"`
	Role      string `json:"role,omitempty"`
}

type column struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// result is the part of a SQL API answer Lumantic reads. Later partitions
// carry only data.
type result struct {
	Meta *struct {
		Format        string            `json:"format"`
		RowType       []column          `json:"rowType"`
		PartitionInfo []json.RawMessage `json:"partitionInfo"`
	} `json:"resultSetMetaData"`
	Data            [][]any `json:"data"`
	StatementHandle string  `json:"statementHandle"`
}

// Query runs one read-only statement and returns its rows from all partitions.
func (s *Snowflake) Query(ctx context.Context, sql string) ([]adapter.Row, error) {
	if !adapter.ReadOnly(sql) {
		return nil, errors.New("Lumantic schickt Snowflake nur lesende Abfragen.")
	}
	body, err := json.Marshal(statementRequest{
		Statement: sql, Timeout: statementTimeout,
		Warehouse: s.Warehouse, Database: s.Database, Role: s.Role,
	})
	if err != nil {
		return nil, err
	}
	status, res, err := s.call(ctx, http.MethodPost, "/api/v2/statements", body)
	if err != nil {
		return nil, err
	}
	handle := res.StatementHandle
	if status == http.StatusAccepted {
		if res, err = s.wait(ctx, handle); err != nil {
			return nil, err
		}
	}
	rows := []adapter.Row{}
	meta := res.Meta
	if meta == nil {
		return rows, nil
	}
	if meta.Format != "" && !strings.EqualFold(meta.Format, "jsonv2") {
		return nil, fmt.Errorf("snowflake: Das Ergebnisformat %q kann Lumantic nicht lesen.", meta.Format)
	}
	keys := rowKeys(meta.RowType)
	rows = appendRows(rows, meta.RowType, keys, res.Data)
	// Partition 0 came with the first answer; the others are fetched one by one.
	for i := 1; i < len(meta.PartitionInfo); i++ {
		path := "/api/v2/statements/" + url.PathEscape(handle) + "?partition=" + strconv.Itoa(i)
		_, part, err := s.call(ctx, http.MethodGet, path, nil)
		if err != nil {
			return nil, err
		}
		rows = appendRows(rows, meta.RowType, keys, part.Data)
	}
	return rows, nil
}

// wait polls a statement that still runs until its result is there, waiting a
// little longer each time. If ctx ends first, it asks Snowflake to cancel the
// statement so the warehouse stops working on it.
func (s *Snowflake) wait(ctx context.Context, handle string) (*result, error) {
	if handle == "" {
		return nil, errors.New("snowflake: Die Antwort 202 nennt keine Abfrage (statementHandle fehlt).")
	}
	path := "/api/v2/statements/" + url.PathEscape(handle)
	for delay := 250 * time.Millisecond; ; delay = min(2*delay, 2*time.Second) {
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			go s.cancel(ctx, handle)
			return nil, fmt.Errorf("snowflake: Abfrage abgebrochen: %w", ctx.Err())
		case <-timer.C:
		}
		status, res, err := s.call(ctx, http.MethodGet, path, nil)
		if err != nil {
			if ctx.Err() != nil {
				go s.cancel(ctx, handle)
			}
			return nil, err
		}
		if status == http.StatusOK {
			return res, nil
		}
	}
}

// cancel asks Snowflake to stop a statement; it is best effort.
func (s *Snowflake) cancel(ctx context.Context, handle string) {
	ctx, stop := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer stop()
	s.call(ctx, http.MethodPost, "/api/v2/statements/"+url.PathEscape(handle)+"/cancel", nil)
}

// call sends one request to the SQL API and decodes the answer. It returns
// status 200 or 202; everything else comes back as an error sentence.
func (s *Snowflake) call(ctx context.Context, method, path string, body []byte) (int, *result, error) {
	base, err := s.base()
	if err != nil {
		return 0, nil, err
	}
	token, kind, err := s.credentials()
	if err != nil {
		return 0, nil, err
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, base+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Snowflake-Authorization-Token-Type", kind)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "lumantic")
	client := s.Client
	if client == nil {
		client = defaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("snowflake: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err == nil {
		data, err = gunzip(data)
	}
	if err != nil {
		return 0, nil, fmt.Errorf("snowflake: %w", err)
	}
	if resp.StatusCode >= 400 {
		if resp.StatusCode == http.StatusUnauthorized && kind == "KEYPAIR_JWT" {
			s.forgetJWT() // a clock gone wrong; the next query signs anew
		}
		return 0, nil, apiError(resp, data)
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return 0, nil, fmt.Errorf("snowflake: unerwartete Antwort %s", resp.Status)
	}
	var res result
	if err := json.Unmarshal(data, &res); err != nil {
		return 0, nil, fmt.Errorf("snowflake: Die Antwort ist nicht lesbar: %v", err)
	}
	return resp.StatusCode, &res, nil
}

// apiError turns an error answer into a sentence, using Snowflake's own
// message when it sends one.
func apiError(resp *http.Response, data []byte) error {
	var e struct {
		Message string `json:"message"`
	}
	msg := ""
	if json.Unmarshal(data, &e) == nil {
		msg = strings.Join(strings.Fields(e.Message), " ")
	}
	if msg == "" {
		msg = resp.Status
		if b := strings.TrimSpace(string(data)); b != "" {
			if len(b) > 300 {
				b = b[:300] + " …"
			}
			msg += ": " + b
		}
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("Snowflake lehnt die Anmeldung ab: %s", msg)
	}
	return fmt.Errorf("snowflake: %s", msg)
}

// gunzip unpacks a gzip body the transport left packed. Snowflake compresses
// later partitions; Go's client normally unpacks them itself.
func gunzip(data []byte) ([]byte, error) {
	if len(data) < 2 || data[0] != 0x1f || data[1] != 0x8b {
		return data, nil
	}
	zr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	return io.ReadAll(zr)
}

func (s *Snowflake) base() (string, error) {
	if s.BaseURL != "" {
		return strings.TrimRight(s.BaseURL, "/"), nil
	}
	acct := strings.ToLower(strings.TrimSpace(s.Account))
	if acct == "" {
		return "", errors.New("Für Snowflake braucht es das Konto, z. B. myorg-myaccount.")
	}
	// Host names take hyphens; Snowflake accepts them in place of the
	// underscores of an account name.
	return "https://" + strings.ReplaceAll(acct, "_", "-") + ".snowflakecomputing.com", nil
}

// credentials returns the bearer token and its type for the
// X-Snowflake-Authorization-Token-Type header.
func (s *Snowflake) credentials() (token, kind string, err error) {
	switch strings.ToLower(strings.TrimSpace(s.Auth)) {
	case "keypair":
		token, err = s.keypairJWT()
		return token, "KEYPAIR_JWT", err
	case "token":
		if strings.TrimSpace(s.Token) == "" {
			return "", "", errors.New("Für die Anmeldung mit Token fehlt das Snowflake-Token.")
		}
		switch kind = strings.ToUpper(strings.TrimSpace(s.TokenType)); kind {
		case "":
			kind = "PROGRAMMATIC_ACCESS_TOKEN"
		case "PROGRAMMATIC_ACCESS_TOKEN", "OAUTH":
		default:
			return "", "", fmt.Errorf("Den Token-Typ %q kennt Lumantic nicht; möglich sind PROGRAMMATIC_ACCESS_TOKEN und OAUTH.", s.TokenType)
		}
		return s.Token, kind, nil
	}
	return "", "", fmt.Errorf("Die Anmeldung bei Snowflake ist «keypair» oder «token», nicht %q.", s.Auth)
}

// keypairJWT returns a JWT signed with the private key, reusing the last one
// until five minutes before it expires. The key file is read only when a new
// JWT is due, so a replaced key takes effect without a restart.
func (s *Snowflake) keypairJWT() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	if s.jwt != "" && now.Before(s.jwtExp.Add(-jwtRenew)) {
		return s.jwt, nil
	}
	switch {
	case strings.TrimSpace(s.Account) == "":
		return "", errors.New("Für Snowflake braucht es das Konto, z. B. myorg-myaccount.")
	case strings.TrimSpace(s.User) == "":
		return "", errors.New("Für Snowflake braucht es den Benutzer.")
	}
	key, err := loadKey(s.KeyFile)
	if err != nil {
		return "", err
	}
	token, err := signJWT(key, s.Account, s.User, now)
	if err != nil {
		return "", err
	}
	s.jwt, s.jwtExp = token, now.Add(jwtLifetime)
	return token, nil
}

func (s *Snowflake) forgetJWT() {
	s.mu.Lock()
	s.jwt = ""
	s.mu.Unlock()
}

type jwtClaims struct {
	Iss string `json:"iss"`
	Sub string `json:"sub"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

// signJWT builds the RS256 JWT of Snowflake's key-pair authentication. The
// account part is the identifier in upper case without the region an account
// locator may carry ("xy12345.eu-central-1" → "XY12345"); the issuer names the
// public key by the SHA-256 fingerprint of its DER encoding.
func signJWT(key *rsa.PrivateKey, account, user string, now time.Time) (string, error) {
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(der)
	acct, _, _ := strings.Cut(strings.ToUpper(strings.TrimSpace(account)), ".")
	who := acct + "." + strings.ToUpper(strings.TrimSpace(user))
	claims, err := json.Marshal(jwtClaims{
		Iss: who + ".SHA256:" + base64.StdEncoding.EncodeToString(sum[:]),
		Sub: who,
		Iat: now.Unix(),
		Exp: now.Add(jwtLifetime).Unix(),
	})
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding
	unsigned := enc.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`)) + "." + enc.EncodeToString(claims)
	digest := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return unsigned + "." + enc.EncodeToString(sig), nil
}

// loadKey reads an unencrypted RSA private key from a PEM file.
func loadKey(path string) (*rsa.PrivateKey, error) {
	if path == "" {
		return nil, errors.New("Für die Anmeldung mit Schlüsselpaar braucht es die Schlüsseldatei.")
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("Die Schlüsseldatei %s gibt es nicht.", path)
	}
	if err != nil {
		return nil, fmt.Errorf("Die Schlüsseldatei %s lässt sich nicht lesen: %v", path, err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("In der Schlüsseldatei %s steht kein Schlüssel im PEM-Format.", path)
	}
	encrypted := func() error {
		return fmt.Errorf("Der Schlüssel in %s ist verschlüsselt. Lumantic braucht ihn unverschlüsselt (PKCS#8); bitte stattdessen die Datei schützen, etwa mit Dateirechten.", path)
	}
	var key any
	switch block.Type {
	case "ENCRYPTED PRIVATE KEY":
		return nil, encrypted()
	case "PRIVATE KEY":
		key, err = x509.ParsePKCS8PrivateKey(block.Bytes)
	case "RSA PRIVATE KEY":
		if strings.Contains(block.Headers["Proc-Type"], "ENCRYPTED") {
			return nil, encrypted()
		}
		key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
	default:
		return nil, fmt.Errorf("In der Schlüsseldatei %s steht kein privater Schlüssel, sondern «%s».", path, block.Type)
	}
	if err != nil {
		return nil, fmt.Errorf("Der Schlüssel in %s ist nicht lesbar: %v", path, err)
	}
	rk, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("Der Schlüssel in %s ist kein RSA-Schlüssel; Snowflake nimmt nur RSA.", path)
	}
	return rk, nil
}

// rowKeys returns the keys each column's value is stored under.
//
// Snowflake folds unquoted names to upper case, so Lumantic's `AS p` comes back
// as "P", while Lumantic reads rows with adapter.String(r, "p"), a plain map
// lookup. So every value is stored under its name as returned and, if that
// differs, also under the lower-case form, unless another column already
// owns that name. Lumantic never ranges over a row's keys, so the second key
// costs nothing; quoting every alias in the dialect instead would reach into
// the SQL compiler.
func rowKeys(cols []column) [][]string {
	taken := make(map[string]bool, len(cols))
	for _, c := range cols {
		taken[c.Name] = true
	}
	keys := make([][]string, len(cols))
	for i, c := range cols {
		keys[i] = []string{c.Name}
		if low := strings.ToLower(c.Name); !taken[low] {
			keys[i] = append(keys[i], low)
			taken[low] = true
		}
	}
	return keys
}

func appendRows(rows []adapter.Row, cols []column, keys [][]string, data [][]any) []adapter.Row {
	for _, rec := range data {
		r := make(adapter.Row, 2*len(cols))
		for i, c := range cols {
			var v any
			if i < len(rec) {
				v = cell(c.Type, rec[i])
			}
			for _, k := range keys[i] {
				r[k] = v
			}
		}
		rows = append(rows, r)
	}
	return rows
}

// cell converts one value of the jsonv2 format, which sends every value as a
// string (or null), by its column type. The reference names the types in
// lower case; upper case is accepted too.
func cell(typ string, v any) any {
	s, ok := v.(string)
	if !ok {
		return v // null, or something the format does not send
	}
	switch strings.ToLower(typ) {
	case "fixed", "real":
		if f, err := strconv.ParseFloat(s, 64); err == nil {
			return f
		}
	case "date": // days since 1970-01-01
		if d, err := strconv.ParseInt(s, 10, 64); err == nil {
			return time.Unix(d*86400, 0).UTC().Format(time.DateOnly)
		}
	case "timestamp_ntz", "timestamp_ltz": // seconds since the epoch, with nine decimals
		if t, ok := epoch(s); ok {
			return t
		}
	case "timestamp_tz": // the same, then a space and the offset in minutes plus 1440
		head, _, _ := strings.Cut(s, " ")
		if t, ok := epoch(head); ok {
			return t
		}
	}
	return s
}

// epoch turns "seconds.fraction" since 1970 into YYYY-MM-DDTHH:MM:SS in UTC.
func epoch(s string) (string, bool) {
	neg := strings.HasPrefix(s, "-")
	whole, frac, _ := strings.Cut(strings.TrimPrefix(s, "-"), ".")
	sec, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return "", false
	}
	var nsec int64
	if frac != "" {
		if nsec, err = strconv.ParseInt((frac + "000000000")[:9], 10, 64); err != nil {
			return "", false
		}
	} else if sec > 1e12 {
		// One example in the reference shows TIMESTAMP_TZ in nanoseconds
		// without a decimal point. No timestamp up to the year 9999 has this
		// many seconds, so such a value can only be nanoseconds.
		sec, nsec = sec/1e9, sec%1e9
	}
	if neg {
		sec, nsec = -sec, -nsec
	}
	return time.Unix(sec, nsec).UTC().Format("2006-01-02T15:04:05"), true
}

// describeSQL lists the columns of every table and view in the current
// database whose schema starts with prefix, case-insensitively.
func describeSQL(d adapter.Dialect, prefix string) string {
	like := strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(prefix) + "%"
	return fmt.Sprintf(`SELECT c.table_schema AS schema_name, c.table_name AS table_name, t.comment AS table_comment,
       c.column_name AS column_name, c.data_type AS data_type, c.comment AS column_comment
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_catalog = c.table_catalog AND t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema ILIKE %s ESCAPE '\\' AND c.table_schema <> 'INFORMATION_SCHEMA'
ORDER BY c.table_schema, c.table_name, c.ordinal_position`, d.Literal(like))
}

// Describe reads tables and columns from the information schema of the
// database, then the values of every dimension. Table names are SCHEMA.TABLE
// as Snowflake stores them.
func (s *Snowflake) Describe(ctx context.Context) (*catalog.Catalog, error) {
	d := adapter.DialectOf(s)
	rows, err := s.Query(ctx, describeSQL(d, s.Schema))
	if err != nil {
		return nil, err
	}
	cat := &catalog.Catalog{Source: s.Source, Dialect: s.Dialect()}
	adapter.AddColumns(cat, rows)
	return cat, adapter.LoadDimensionValues(ctx, s.Query, cat, d)
}
