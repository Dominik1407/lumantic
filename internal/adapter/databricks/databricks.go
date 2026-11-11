// Package databricks reads a gold layer on Databricks. It sends read-only
// queries to a SQL warehouse through the SQL Statement Execution API 2.0 and
// takes the catalog from Unity Catalog's information schema.
package databricks

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"lumantic/internal/adapter"
	"lumantic/internal/catalog"
)

// Databricks talks to one SQL warehouse of one workspace. It only reads:
// every statement passes adapter.ReadOnly before it leaves Lumantic.
type Databricks struct {
	Host         string       // workspace URL, e.g. https://adb-1234567890123456.7.azuredatabricks.net
	Warehouse    string       // SQL warehouse ID
	Catalog      string       // Unity Catalog catalog; "" = the warehouse's default catalog
	Schema       string       // schema prefix to expose, case-insensitive; "" = all but information_schema
	Source       string       // human name of the gold layer
	Auth         string       // "token" (personal access or other bearer token) or "oauth" (service principal, machine-to-machine)
	Token        string       // for "token"
	ClientID     string       // for "oauth"
	ClientSecret string       // for "oauth"
	Client       *http.Client // nil = a shared client with a 60 s timeout

	mu      sync.Mutex // guards the cached OAuth token and the traded ones
	oauth   string
	expires time.Time
	traded  map[string]traded // Databricks tokens for people's logins (onbehalf.go)
}

var _ adapter.Adapter = (*Databricks)(nil)

var defaultClient = &http.Client{Timeout: 60 * time.Second}

func (d *Databricks) Name() string    { return "databricks" }
func (d *Databricks) Dialect() string { return "databricks" }

const statements = "/api/2.0/sql/statements/"

type statementRequest struct {
	Statement     string `json:"statement"`
	WarehouseID   string `json:"warehouse_id"`
	Catalog       string `json:"catalog,omitempty"`
	WaitTimeout   string `json:"wait_timeout"`
	OnWaitTimeout string `json:"on_wait_timeout"`
	Disposition   string `json:"disposition"`
	Format        string `json:"format"`
}

// statement is the answer to a submit or a poll.
type statement struct {
	StatementID string `json:"statement_id"`
	Status      struct {
		State string `json:"state"`
		Error *struct {
			ErrorCode string `json:"error_code"`
			Message   string `json:"message"`
		} `json:"error"`
	} `json:"status"`
	Manifest *struct {
		Schema struct {
			Columns []column `json:"columns"`
		} `json:"schema"`
		Truncated bool `json:"truncated"`
	} `json:"manifest"`
	Result *chunk `json:"result"`
}

type column struct {
	Name     string `json:"name"`
	TypeName string `json:"type_name"`
	Position int    `json:"position"` // 0-based
}

// chunk is one part of a result. With format JSON_ARRAY every cell is a
// string or null.
type chunk struct {
	DataArray             [][]any `json:"data_array"`
	NextChunkInternalLink string  `json:"next_chunk_internal_link"`
}

// Query runs one read-only statement and returns its rows, keyed by column name.
func (d *Databricks) Query(ctx context.Context, sql string) ([]adapter.Row, error) {
	if !adapter.ReadOnly(sql) {
		return nil, errors.New("Lumantic schickt Databricks nur lesende Abfragen.")
	}
	if strings.TrimSpace(d.Host) == "" {
		return nil, errors.New("Für Databricks fehlt die Adresse des Workspace.")
	}
	if d.Warehouse == "" {
		return nil, errors.New("Für Databricks fehlt die ID des SQL-Warehouse.")
	}
	// Databricks waits up to wait_timeout for the result and then answers
	// PENDING or RUNNING; the statement keeps running and is polled.
	var st statement
	err := d.call(ctx, http.MethodPost, statements, statementRequest{
		Statement:     sql,
		WarehouseID:   d.Warehouse,
		Catalog:       d.Catalog,
		WaitTimeout:   "30s",
		OnWaitTimeout: "CONTINUE",
		Disposition:   "INLINE",
		Format:        "JSON_ARRAY",
	}, &st)
	if err != nil {
		return nil, err
	}
	if st, err = d.wait(ctx, st); err != nil {
		return nil, err
	}
	return d.rows(ctx, st)
}

// wait polls a pending or running statement until it ends. When ctx ends
// first, it asks Databricks to cancel the statement.
func (d *Databricks) wait(ctx context.Context, st statement) (statement, error) {
	delay := 250 * time.Millisecond
	for st.Status.State == "PENDING" || st.Status.State == "RUNNING" {
		id := st.StatementID
		if id == "" {
			return st, errors.New("databricks: Antwort ohne statement_id")
		}
		select {
		case <-ctx.Done():
			d.cancel(ctx, id)
			return st, ctx.Err()
		case <-time.After(delay):
		}
		delay = min(2*delay, 2*time.Second)
		var next statement
		if err := d.call(ctx, http.MethodGet, statements+url.PathEscape(id), nil, &next); err != nil {
			d.cancel(ctx, id)
			if ctx.Err() != nil {
				return st, ctx.Err()
			}
			return st, err
		}
		if next.StatementID == "" {
			next.StatementID = id
		}
		st = next
	}
	switch st.Status.State {
	case "SUCCEEDED":
		return st, nil
	case "FAILED", "CANCELED", "CLOSED":
		return st, stateError(st)
	}
	return st, fmt.Errorf("databricks: unbekannter Zustand %q", st.Status.State)
}

func stateError(st statement) error {
	var s string
	switch st.Status.State {
	case "FAILED":
		s = "Die Abfrage ist in Databricks fehlgeschlagen"
	case "CANCELED":
		s = "Databricks hat die Abfrage abgebrochen"
	default:
		s = "Databricks hat die Abfrage geschlossen"
	}
	if e := st.Status.Error; e != nil && e.Message != "" {
		return fmt.Errorf("%s: %s", s, e.Message)
	}
	return errors.New(s + ".")
}

// cancel asks Databricks to stop a statement Lumantic no longer waits for.
// It is best effort: errors are ignored.
func (d *Databricks) cancel(ctx context.Context, id string) {
	ctx, stop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer stop()
	var ignored json.RawMessage
	_ = d.call(ctx, http.MethodPost, statements+url.PathEscape(id)+"/cancel", nil, &ignored)
}

// rows reads the first chunk from the statement and follows the links to
// the next ones.
func (d *Databricks) rows(ctx context.Context, st statement) ([]adapter.Row, error) {
	if st.Manifest == nil {
		return nil, errors.New("databricks: Antwort ohne Spaltenbeschreibung")
	}
	// Only happens with row_limit or byte_limit, which Lumantic does not
	// set; half a result would still show wrong totals, so refuse it.
	if st.Manifest.Truncated {
		return nil, errors.New("Databricks hat das Ergebnis gekürzt; Lumantic zeigt keine unvollständigen Zahlen.")
	}
	cols := st.Manifest.Schema.Columns
	pos := positions(cols)
	rows := []adapter.Row{}
	for part := st.Result; part != nil; {
		for _, cells := range part.DataArray {
			r := make(adapter.Row, len(cols))
			for i, c := range cols {
				var v any
				if p := pos[i]; p < len(cells) {
					v = cells[p]
				}
				r[c.Name] = cell(c.TypeName, v)
			}
			rows = append(rows, r)
		}
		link := part.NextChunkInternalLink
		if link == "" {
			break
		}
		// The link is a path on the workspace. Anything else would send
		// the token elsewhere.
		if !strings.HasPrefix(link, "/") || strings.HasPrefix(link, "//") {
			return nil, fmt.Errorf("databricks: unerwarteter Verweis auf den nächsten Teil: %q", link)
		}
		var next chunk
		if err := d.call(ctx, http.MethodGet, link, nil, &next); err != nil {
			return nil, err
		}
		part = &next
	}
	return rows, nil
}

// positions maps each column to its cell. It trusts the columns' positions
// when they number the cells 0…n-1, else their order.
func positions(cols []column) []int {
	pos := make([]int, len(cols))
	seen := make([]bool, len(cols))
	for i, c := range cols {
		if c.Position < 0 || c.Position >= len(cols) || seen[c.Position] {
			for j := range pos {
				pos[j] = j
			}
			return pos
		}
		seen[c.Position] = true
		pos[i] = c.Position
	}
	return pos
}

// cell turns one JSON_ARRAY cell into the value Lumantic expects: numbers as
// float64, timestamps as YYYY-MM-DDTHH:MM:SS, everything else as text.
func cell(typeName string, v any) any {
	s, ok := v.(string)
	if !ok {
		return v // null, or a value that already arrived typed
	}
	switch strings.ToUpper(typeName) {
	case "BYTE", "SHORT", "INT", "LONG", "FLOAT", "DOUBLE", "DECIMAL":
		if f, err := strconv.ParseFloat(s, 64); err == nil && !math.IsInf(f, 0) && !math.IsNaN(f) {
			return f
		}
	case "TIMESTAMP", "TIMESTAMP_NTZ":
		return timestamp(s)
	}
	return s
}

// Unsure about the exact text Databricks writes for timestamps (ISO 8601
// with T and Z is documented in examples, a space instead of T is seen
// elsewhere), so several layouts are tried. Fractions are accepted without
// being in the layout. The wall clock is kept as delivered, the zone dropped.
var stampLayouts = []string{
	"2006-01-02T15:04:05Z07:00",
	"2006-01-02T15:04:05Z0700",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05Z07:00",
	"2006-01-02 15:04:05Z0700",
	"2006-01-02 15:04:05",
}

func timestamp(s string) string {
	for _, l := range stampLayouts {
		if t, err := time.Parse(l, s); err == nil {
			return t.Format("2006-01-02T15:04:05")
		}
	}
	return s
}

// Describe reads tables, columns and comments from the information schema,
// then the values of every text column.
func (d *Databricks) Describe(ctx context.Context) (*catalog.Catalog, error) {
	dia := adapter.DialectOf(d)
	is := "information_schema"
	if d.Catalog != "" {
		is = dia.Ident(d.Catalog) + ".information_schema"
	}
	where := "lower(c.table_schema) <> 'information_schema'"
	if d.Schema != "" {
		where += "\n  AND lower(c.table_schema) LIKE " + dia.Literal(likePrefix(strings.ToLower(d.Schema)))
	}
	rows, err := d.Query(ctx, fmt.Sprintf(`
SELECT c.table_schema AS schema_name, c.table_name AS table_name, t.comment AS table_comment,
       c.column_name AS column_name, c.data_type AS data_type, c.comment AS column_comment
FROM %[1]s.columns c
JOIN %[1]s.tables t
  ON t.table_catalog = c.table_catalog AND t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE %[2]s
ORDER BY c.table_schema, c.table_name, c.ordinal_position`, is, where))
	if err != nil {
		return nil, err
	}
	cat := &catalog.Catalog{Source: d.Source, Dialect: d.Dialect()}
	adapter.AddColumns(cat, rows)
	return cat, adapter.LoadDimensionValues(ctx, d.Query, cat, dia)
}

// likePrefix makes a LIKE pattern that matches s literally at the start.
// Databricks' LIKE escapes with a backslash by default; the dialect's Literal
// then doubles that backslash inside the string literal.
func likePrefix(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s) + "%"
}

// base is the workspace URL without a trailing slash, https:// if no scheme
// is given.
func (d *Databricks) base() string {
	h := strings.TrimRight(strings.TrimSpace(d.Host), "/")
	if !strings.Contains(h, "://") {
		h = "https://" + h
	}
	return h
}

// call sends one authenticated request to the workspace and decodes the
// JSON answer into out.
func (d *Databricks) call(ctx context.Context, method, path string, body, out any) error {
	token, err := d.bearer(ctx)
	if err != nil {
		return err
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.base()+path, rd)
	if err != nil {
		return fmt.Errorf("databricks: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	err = d.send(req, out)
	var he *httpError
	if errors.As(err, &he) && he.status == http.StatusUnauthorized && d.authMode() == "oauth" {
		d.forget() // the next query fetches a fresh token
	}
	return err
}

// send does one round trip and decodes a JSON answer into out.
func (d *Databricks) send(req *http.Request, out any) error {
	req.Header.Set("User-Agent", "lumantic")
	req.Header.Set("Accept", "application/json")
	client := d.Client
	if client == nil {
		client = defaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("databricks: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("databricks: %w", err)
	}
	if resp.StatusCode >= 400 {
		return &httpError{status: resp.StatusCode, msg: message(resp.Status, data)}
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("databricks: Antwort nicht lesbar: %w", err)
	}
	return nil
}

type httpError struct {
	status int
	msg    string
}

func (e *httpError) Error() string {
	if e.status == http.StatusUnauthorized || e.status == http.StatusForbidden {
		return "Databricks lehnt die Anmeldung ab: " + e.msg
	}
	return "databricks: " + e.msg
}

// message takes the text of an error answer: the REST APIs send "message",
// the OAuth endpoint "error_description" and "error".
func message(status string, body []byte) string {
	var m map[string]any
	if json.Unmarshal(body, &m) == nil {
		for _, k := range []string{"message", "error_description", "error"} {
			if s, ok := m[k].(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	text := strings.TrimSpace(string(body))
	if r := []rune(text); len(r) > 300 {
		text = string(r[:300]) + "…"
	}
	if text == "" {
		return status
	}
	return status + ": " + text
}

func (d *Databricks) authMode() string { return strings.ToLower(strings.TrimSpace(d.Auth)) }

// bearer returns the token for the Authorization header.
func (d *Databricks) bearer(ctx context.Context) (string, error) {
	switch d.authMode() {
	case "", "token":
		if d.Token == "" {
			return "", errors.New("Für Databricks fehlt der Token.")
		}
		return d.Token, nil
	case "oauth":
		return d.oauthToken(ctx)
	}
	return "", fmt.Errorf("Die Anmeldung %q kennt Lumantic für Databricks nicht; möglich sind \"token\" und \"oauth\".", d.Auth)
}

// oauthToken returns the service principal's access token. It is fetched
// once and renewed a minute before it runs out.
func (d *Databricks) oauthToken(ctx context.Context) (string, error) {
	var missing []string
	if d.ClientID == "" {
		missing = append(missing, "die Client-ID")
	}
	if d.ClientSecret == "" {
		missing = append(missing, "das Client-Secret")
	}
	switch len(missing) {
	case 1:
		return "", fmt.Errorf("Für die OAuth-Anmeldung bei Databricks fehlt %s.", missing[0])
	case 2:
		return "", fmt.Errorf("Für die OAuth-Anmeldung bei Databricks fehlen %s.", strings.Join(missing, " und "))
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.oauth != "" && time.Now().Before(d.expires) {
		return d.oauth, nil
	}
	form := url.Values{"grant_type": {"client_credentials"}, "scope": {"all-apis"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.base()+"/oidc/v1/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("databricks: %w", err)
	}
	req.SetBasicAuth(d.ClientID, d.ClientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"` // seconds
	}
	if err := d.send(req, &tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", errors.New("databricks: Antwort ohne access_token")
	}
	d.oauth = tok.AccessToken
	d.expires = time.Now().Add(time.Duration(tok.ExpiresIn)*time.Second - time.Minute)
	return d.oauth, nil
}

func (d *Databricks) forget() {
	d.mu.Lock()
	d.oauth = ""
	d.mu.Unlock()
}
