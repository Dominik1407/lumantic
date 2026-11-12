// Package config holds Lumantic's settings: where the gold layer is, which key
// figures to read, how Lumina reaches Claude, and how the app looks. They live
// in one JSON file (config/lumantic.json). Environment variables win over the
// file; a setting fixed by one is "locked" and cannot be changed in the app.
// Secrets never go into this file (see secrets.go).
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const Version = "0.11.0"

type Windmill struct {
	URL       string `json:"url"`
	Workspace string `json:"workspace"`
	Describe  string `json:"describe"`
	Query     string `json:"query"`
}

// Snowflake is reached over its SQL API. The token for auth "token" lives with
// the secrets; a private key stays in its own file.
type Snowflake struct {
	Account   string `json:"account"` // account identifier, e.g. myorg-myaccount
	User      string `json:"user"`
	Role      string `json:"role"`
	Warehouse string `json:"warehouse"`
	Database  string `json:"database"`
	Auth      string `json:"auth"`    // "keypair" (recommended) or "token"
	KeyFile   string `json:"keyFile"` // keypair: PEM file with the unencrypted private key
}

// Databricks is reached over its SQL Statement API on one SQL warehouse.
type Databricks struct {
	Host      string `json:"host"`      // workspace URL
	Warehouse string `json:"warehouse"` // SQL warehouse ID
	Catalog   string `json:"catalog"`   // Unity Catalog catalog; empty = the warehouse's default
	Auth      string `json:"auth"`      // "oauth" (service principal, recommended) or "token"
	ClientID  string `json:"clientId"`  // oauth: the service principal's application ID
}

type Data struct {
	Type       string     `json:"type"`   // "duckdb", "files", "snowflake", "databricks" or "windmill"
	Name       string     `json:"name"`   // shown in the app
	Path       string     `json:"path"`   // duckdb: database file · files: folder with .parquet/.csv
	Schema     string     `json:"schema"` // duckdb, snowflake, databricks: schema prefix to expose · files: schema of the views
	DuckDB     string     `json:"duckdb"` // path to the DuckDB CLI; empty = PATH
	Snowflake  Snowflake  `json:"snowflake,omitzero"`
	Databricks Databricks `json:"databricks,omitzero"`
	Windmill   Windmill   `json:"windmill"`
}

type AI struct {
	Enabled  bool   `json:"enabled"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	BaseURL  string `json:"baseURL"`
}

// UI holds the defaults for everyone; each person can override them in the app.
type UI struct {
	Design   string `json:"design"`
	Font     string `json:"font"`
	Accent   string `json:"accent"`
	Motion   string `json:"motion"`
	TextSize string `json:"textSize"`
	Start    string `json:"start"`
	Lens     string `json:"lens"`
	Hints    bool   `json:"hints"`
	// Language of the interface: "de", "en", or "" for the browser's.
	Language string `json:"language"`
}

type FontFile struct {
	Family string `json:"family"`
	File   string `json:"file"`
	Weight string `json:"weight"`
	Style  string `json:"style"`
}

// Design is a corporate design: colours over a built-in base design.
type Design struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Base      string            `json:"base"`
	Colors    map[string]string `json:"colors"`
	Fonts     map[string]string `json:"fonts"`
	FontFiles []FontFile        `json:"fontFiles"`
}

type Brand struct {
	Name     string   `json:"name"`
	Logo     string   `json:"logo"`     // file in config/brand/; takes the place of the Lumantic logo
	LogoDark string   `json:"logoDark"` // the same logo for dark designs; empty = logo
	Designs  []Design `json:"designs"`
}

// MainID names the first Kosmos: the top-level "data" and "metrics" of the file.
const MainID = "main"

// Kosmos is one more room beside the first: its own data source and key figures.
// The first Kosmos stays at the top level of the file ("data", "metrics"), so a
// config with a single source reads as it always did.
type Kosmos struct {
	ID      string   `json:"id"`                // short name in addresses, e.g. "firmenkunden"
	Data    Data     `json:"data"`              // its data source; data.name is the name shown in the app
	Metrics string   `json:"metrics"`           // key figure file; empty = none defined yet
	Refresh *Refresh `json:"refresh,omitempty"` // when it is read again by itself; nil = the usual for its source
	Access  []string `json:"access,omitempty"`  // groups that see it; empty = everyone signed in
	Editors []string `json:"editors,omitempty"` // groups that look after its key figures; empty = the admins
	Rights  string   `json:"rights,omitempty"`  // "lumantic" (default) or "source": ask the database in the person's name
	Grain   string   `json:"grain,omitempty"`   // standard raster: "monat" (default), "quartal" or "jahr"
}

type Config struct {
	Data    Data     `json:"data"`
	Metrics string   `json:"metrics"`           // key figure file; empty = built-in ALCO definitions
	Refresh *Refresh `json:"refresh,omitempty"` // when the first Kosmos is read again by itself; nil = the usual
	Access  []string `json:"access,omitempty"`  // groups that see the first Kosmos; empty = everyone signed in
	Editors []string `json:"editors,omitempty"` // groups that look after its key figures; empty = the admins
	Rights  string   `json:"rights,omitempty"`  // "lumantic" (default) or "source" for the first Kosmos
	Grain   string   `json:"grain,omitempty"`   // standard raster of the first Kosmos: "monat" (default), "quartal" or "jahr"
	Auth    Auth     `json:"auth"`              // how people sign in; only in this file, never from the app
	Kosmen  []Kosmos `json:"kosmen"`            // further rooms, each over its own data source
	AI      AI       `json:"ai"`
	UI      UI       `json:"ui"`
	Brand   Brand    `json:"brand"`
}

// Find returns the index of a further Kosmos, or -1.
func (c *Config) Find(id string) int {
	for i, k := range c.Kosmen {
		if k.ID == id {
			return i
		}
	}
	return -1
}

// Models lists the Claude models offered in the app.
var Models = []Model{
	{ID: "claude-opus-5-5", Name: "Claude Opus 5.5", Note: "am gründlichsten"},
	{ID: "claude-sonnet-5-5", Name: "Claude Sonnet 5.5", Note: "schnell und gründlich"},
	{ID: "claude-haiku-5-5", Name: "Claude Haiku 5.5", Note: "am schnellsten"},
}

type Model struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Note string `json:"note"`
}

func Defaults() Config {
	return Config{
		Data: Data{Type: "duckdb", Name: "Goldlayer", Path: "goldlayer/gold.duckdb", Schema: "gold",
			Windmill: Windmill{Workspace: "lumantic", Describe: "f/lumantic/describe", Query: "f/lumantic/query"}},
		Kosmen: []Kosmos{},
		AI:     AI{Enabled: true, Provider: "anthropic", Model: "claude-opus-5-5"},
		Auth:   Auth{Kind: "none", Admins: []string{}},
		UI:     UI{Design: "nebel", Motion: "voll", TextSize: "normal", Start: "heute", Lens: "1J", Hints: true},
		Brand:  Brand{Designs: []Design{}},
	}
}

// DefaultData is the source a new Kosmos starts from before its fields are filled in.
func DefaultData() Data { return Defaults().Data }

// ---- environment ----

// binding ties a setting to the environment variable that can fix it.
type binding struct {
	path string
	env  []string
	get  func(*Config) string
	set  func(*Config, string)
}

func boolText(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

var bindings = []binding{
	{"data.type", []string{"LUMANTIC_ADAPTER"}, func(c *Config) string { return c.Data.Type }, func(c *Config, v string) { c.Data.Type = strings.ToLower(v) }},
	{"data.path", []string{"LUMANTIC_GOLD"}, func(c *Config) string { return c.Data.Path }, func(c *Config, v string) { c.Data.Path = v }},
	{"data.schema", []string{"LUMANTIC_SCHEMA"}, func(c *Config) string { return c.Data.Schema }, func(c *Config, v string) { c.Data.Schema = v }},
	{"data.name", []string{"LUMANTIC_SOURCE"}, func(c *Config) string { return c.Data.Name }, func(c *Config, v string) { c.Data.Name = v }},
	{"data.duckdb", []string{"LUMANTIC_DUCKDB"}, func(c *Config) string { return c.Data.DuckDB }, func(c *Config, v string) { c.Data.DuckDB = v }},
	{"data.snowflake.account", []string{"SNOWFLAKE_ACCOUNT"}, func(c *Config) string { return c.Data.Snowflake.Account }, func(c *Config, v string) { c.Data.Snowflake.Account = v }},
	{"data.snowflake.user", []string{"SNOWFLAKE_USER"}, func(c *Config) string { return c.Data.Snowflake.User }, func(c *Config, v string) { c.Data.Snowflake.User = v }},
	{"data.snowflake.role", []string{"SNOWFLAKE_ROLE"}, func(c *Config) string { return c.Data.Snowflake.Role }, func(c *Config, v string) { c.Data.Snowflake.Role = v }},
	{"data.snowflake.warehouse", []string{"SNOWFLAKE_WAREHOUSE"}, func(c *Config) string { return c.Data.Snowflake.Warehouse }, func(c *Config, v string) { c.Data.Snowflake.Warehouse = v }},
	{"data.snowflake.database", []string{"SNOWFLAKE_DATABASE"}, func(c *Config) string { return c.Data.Snowflake.Database }, func(c *Config, v string) { c.Data.Snowflake.Database = v }},
	{"data.snowflake.keyFile", []string{"SNOWFLAKE_PRIVATE_KEY_FILE"}, func(c *Config) string { return c.Data.Snowflake.KeyFile }, func(c *Config, v string) { c.Data.Snowflake.KeyFile = v }},
	{"data.databricks.host", []string{"DATABRICKS_HOST"}, func(c *Config) string { return c.Data.Databricks.Host }, func(c *Config, v string) { c.Data.Databricks.Host = v }},
	{"data.databricks.warehouse", []string{"DATABRICKS_WAREHOUSE_ID"}, func(c *Config) string { return c.Data.Databricks.Warehouse }, func(c *Config, v string) { c.Data.Databricks.Warehouse = v }},
	{"data.databricks.catalog", []string{"DATABRICKS_CATALOG"}, func(c *Config) string { return c.Data.Databricks.Catalog }, func(c *Config, v string) { c.Data.Databricks.Catalog = v }},
	{"data.databricks.clientId", []string{"DATABRICKS_CLIENT_ID"}, func(c *Config) string { return c.Data.Databricks.ClientID }, func(c *Config, v string) { c.Data.Databricks.ClientID = v }},
	{"data.windmill.url", []string{"WINDMILL_URL"}, func(c *Config) string { return c.Data.Windmill.URL }, func(c *Config, v string) { c.Data.Windmill.URL = v }},
	{"data.windmill.workspace", []string{"WINDMILL_WORKSPACE"}, func(c *Config) string { return c.Data.Windmill.Workspace }, func(c *Config, v string) { c.Data.Windmill.Workspace = v }},
	{"data.windmill.describe", []string{"WINDMILL_DESCRIBE"}, func(c *Config) string { return c.Data.Windmill.Describe }, func(c *Config, v string) { c.Data.Windmill.Describe = v }},
	{"data.windmill.query", []string{"WINDMILL_QUERY"}, func(c *Config) string { return c.Data.Windmill.Query }, func(c *Config, v string) { c.Data.Windmill.Query = v }},
	{"auth.kind", []string{"LUMANTIC_AUTH"}, func(c *Config) string { return c.Auth.Kind }, func(c *Config, v string) { c.Auth.Kind = strings.ToLower(v) }},
	{"auth.admins", []string{"LUMANTIC_ADMINS"}, func(c *Config) string { return strings.Join(c.Auth.Admins, ",") }, func(c *Config, v string) { c.Auth.Admins = cleanList(strings.Split(v, ",")) }},
	{"auth.oidc.issuer", []string{"OIDC_ISSUER"}, func(c *Config) string { return c.Auth.OIDC.Issuer }, func(c *Config, v string) { c.Auth.OIDC.Issuer = v }},
	{"auth.oidc.clientId", []string{"OIDC_CLIENT_ID"}, func(c *Config) string { return c.Auth.OIDC.ClientID }, func(c *Config, v string) { c.Auth.OIDC.ClientID = v }},
	{"auth.oidc.url", []string{"LUMANTIC_URL"}, func(c *Config) string { return c.Auth.OIDC.URL }, func(c *Config, v string) { c.Auth.OIDC.URL = v }},
	{"metrics", []string{"LUMANTIC_METRICS"}, func(c *Config) string { return c.Metrics }, func(c *Config, v string) { c.Metrics = v }},
	{"ai.enabled", []string{"LUMANTIC_LUMINA"}, func(c *Config) string { return boolText(c.AI.Enabled) }, func(c *Config, v string) { c.AI.Enabled = v == "true" }},
	{"ai.model", []string{"LUMANTIC_MODEL"}, func(c *Config) string { return c.AI.Model }, func(c *Config, v string) { c.AI.Model = v }},
	{"ai.baseURL", []string{"ANTHROPIC_BASE_URL"}, func(c *Config) string { return c.AI.BaseURL }, func(c *Config, v string) { c.AI.BaseURL = v }},
}

// envValue reads a binding's variable. LUMANTIC_LUMINA speaks in modes.
func envValue(lookup func(string) (string, bool), b binding) (string, string, bool) {
	for _, name := range b.env {
		v, ok := lookup(name)
		if !ok || strings.TrimSpace(v) == "" {
			continue
		}
		v = strings.TrimSpace(v)
		if name == "LUMANTIC_LUMINA" {
			switch strings.ToLower(v) {
			case "claude", "an", "on", "true":
				return "true", name, true
			case "beispiel", "offline", "aus", "off", "false":
				return "false", name, true
			default:
				continue
			}
		}
		return v, name, true
	}
	return "", "", false
}

// ---- manager ----

// Manager owns the config file and the secrets file.
type Manager struct {
	mu          sync.Mutex
	path        string
	secretsPath string
	lookup      func(string) (string, bool)
	file        Config
	exists      bool
	secrets     map[string]string
}

// Open reads the config file (missing = defaults) and the secrets file.
// lookup reads the environment; nil means os.LookupEnv.
func Open(path, secretsPath string, lookup func(string) (string, bool)) (*Manager, error) {
	if lookup == nil {
		lookup = os.LookupEnv
	}
	m := &Manager{path: path, secretsPath: secretsPath, lookup: lookup, file: Defaults(), secrets: map[string]string{}}
	raw, err := os.ReadFile(path)
	switch {
	case err == nil:
		c := Defaults()
		if err := json.Unmarshal(raw, &c); err != nil {
			return nil, fmt.Errorf("Die Konfiguration %s ist kein gültiges JSON: %w", path, err)
		}
		normalize(&c)
		m.file, m.exists = c, true
	case errors.Is(err, os.ErrNotExist):
	default:
		return nil, err
	}
	if err := m.loadSecrets(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) Path() string { return m.path }

// Dir is the folder of the config file; kennzahlen.json and brand/ live there.
func (m *Manager) Dir() string { return filepath.Dir(m.path) }

func (m *Manager) Exists() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.exists
}

// File returns the settings as stored, without the environment.
func (m *Manager) File() Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	return clone(m.file)
}

// Effective returns the stored settings with the environment applied.
func (m *Manager) Effective() Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.effective(m.file)
}

// EffectiveOf applies the environment to a candidate config (before it is saved).
func (m *Manager) EffectiveOf(file Config) Config {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.effective(file)
}

// Normalize trims values and fills the defaults Validate expects.
func Normalize(c *Config) { normalize(c) }

func (m *Manager) effective(file Config) Config {
	c := clone(file)
	for _, b := range bindings {
		if v, _, ok := envValue(m.lookup, b); ok {
			b.set(&c, v)
		}
	}
	// A kind chosen by a variable (LUMANTIC_AUTH=proxy, LUMANTIC_ADAPTER=snowflake)
	// gets the defaults of that kind, as if it stood in the file.
	normalize(&c)
	return c
}

// Locked lists the settings fixed by environment variables, secrets included.
func (m *Manager) Locked() []string {
	out := []string{}
	for _, b := range bindings {
		if _, _, ok := envValue(m.lookup, b); ok {
			out = append(out, b.path)
		}
	}
	for _, s := range secretKeys {
		if _, _, ok := m.envSecret(s.key); ok {
			out = append(out, s.path)
		}
	}
	return out
}

// LockedError means a request tried to change a setting an env var fixes.
type LockedError struct{ Path, Env string }

func (e *LockedError) Error() string {
	return fmt.Sprintf("Die Einstellung %s ist durch die Umgebungsvariable %s festgelegt.", e.Path, e.Env)
}

// Merge builds the stored config a request asks for: each given section is laid
// over the current one field by field. Unknown keys are ignored. A locked
// setting may be sent unchanged (or with its env value), never changed.
func (m *Manager) Merge(req map[string]json.RawMessage) (Config, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cand := clone(m.file)
	for key, raw := range req {
		var err error
		switch key {
		case "data":
			err = json.Unmarshal(raw, &cand.Data)
		case "ai":
			err = json.Unmarshal(raw, &cand.AI)
		case "ui":
			err = json.Unmarshal(raw, &cand.UI)
		case "brand":
			err = json.Unmarshal(raw, &cand.Brand)
		case "metrics":
			err = json.Unmarshal(raw, &cand.Metrics)
		case "refresh":
			// null goes back to the usual schedule for the source.
			var r *Refresh
			if err = json.Unmarshal(raw, &r); err == nil {
				cand.Refresh = r
			}
		case "grain":
			err = json.Unmarshal(raw, &cand.Grain)
		}
		if err != nil {
			return Config{}, fmt.Errorf("Einstellung %s ist ungültig: %v", key, err)
		}
	}
	normalize(&cand)
	for _, b := range bindings {
		envV, name, ok := envValue(m.lookup, b)
		if !ok {
			continue
		}
		before, now := b.get(&m.file), b.get(&cand)
		if now == before {
			continue
		}
		if now == envV || (b.path == "data.type" && strings.EqualFold(now, envV)) {
			b.set(&cand, before)
			continue
		}
		return Config{}, &LockedError{Path: b.path, Env: name}
	}
	return cand, nil
}

// Save validates and writes the config file atomically.
func (m *Manager) Save(c Config) error {
	normalize(&c)
	if err := Validate(c); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := writeAtomic(m.path, append(raw, '\n'), 0o644); err != nil {
		return fmt.Errorf("Die Konfiguration lässt sich nicht speichern: %w", err)
	}
	m.file, m.exists = clone(c), true
	return nil
}

func writeAtomic(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	os.Chmod(name, mode)
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}

func clone(c Config) Config {
	raw, _ := json.Marshal(c)
	var out Config
	json.Unmarshal(raw, &out)
	if out.Brand.Designs == nil {
		out.Brand.Designs = []Design{}
	}
	if out.Kosmen == nil {
		out.Kosmen = []Kosmos{}
	}
	return out
}

// NormalizeData trims one data source and fills what Validate expects.
func NormalizeData(d *Data) {
	sf, db := &d.Snowflake, &d.Databricks
	for _, p := range []*string{&d.Type, &d.Name, &d.Path, &d.Schema, &d.DuckDB,
		&sf.Account, &sf.User, &sf.Role, &sf.Warehouse, &sf.Database, &sf.Auth, &sf.KeyFile,
		&db.Host, &db.Warehouse, &db.Catalog, &db.Auth, &db.ClientID,
		&d.Windmill.URL, &d.Windmill.Workspace, &d.Windmill.Describe, &d.Windmill.Query} {
		*p = strings.TrimSpace(*p)
	}
	d.Type = strings.ToLower(d.Type)
	if d.Type == "" {
		d.Type = "duckdb"
	}
	if d.Type == "files" && d.Schema == "" {
		d.Schema = "gold"
	}
	// Each warehouse keeps only its own block, so a config reads as what it uses.
	if d.Type != "snowflake" {
		*sf = Snowflake{}
	} else if sf.Auth == "" {
		sf.Auth = "keypair"
	}
	if d.Type != "databricks" {
		*db = Databricks{}
	} else {
		if db.Auth == "" {
			db.Auth = "oauth"
		}
		if db.Host != "" && !strings.Contains(db.Host, "://") {
			db.Host = "https://" + db.Host
		}
		db.Host = strings.TrimRight(db.Host, "/")
	}
}

func normalize(c *Config) {
	trim := func(p *string) { *p = strings.TrimSpace(*p) }
	for _, p := range []*string{&c.Metrics, &c.AI.Provider, &c.AI.Model, &c.AI.BaseURL,
		&c.UI.Design, &c.UI.Font, &c.UI.Accent, &c.UI.Motion, &c.UI.TextSize, &c.UI.Start, &c.UI.Lens, &c.UI.Language,
		&c.Brand.Name, &c.Brand.Logo, &c.Brand.LogoDark} {
		trim(p)
	}
	NormalizeData(&c.Data)
	normalizeRefresh(c.Refresh, c.Data)
	NormalizeAuth(&c.Auth)
	c.Access, c.Editors, c.Rights = cleanList(c.Access), cleanList(c.Editors), strings.ToLower(strings.TrimSpace(c.Rights))
	normalizeGrain(&c.Grain)
	if c.Kosmen == nil {
		c.Kosmen = []Kosmos{}
	}
	for i := range c.Kosmen {
		trim(&c.Kosmen[i].ID)
		trim(&c.Kosmen[i].Metrics)
		NormalizeData(&c.Kosmen[i].Data)
		normalizeRefresh(c.Kosmen[i].Refresh, c.Kosmen[i].Data)
		k := &c.Kosmen[i]
		k.Access, k.Editors, k.Rights = cleanList(k.Access), cleanList(k.Editors), strings.ToLower(strings.TrimSpace(k.Rights))
		normalizeGrain(&k.Grain)
	}
	if c.AI.Provider == "" {
		c.AI.Provider = "anthropic"
	}
	if c.AI.Model == "" {
		c.AI.Model = "claude-opus-5-5"
	}
	if c.Brand.Designs == nil {
		c.Brand.Designs = []Design{}
	}
}

var (
	schemaRe  = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`)
	prefixRe  = regexp.MustCompile(`^[A-Za-z0-9_]{0,63}$`)
	modelRe   = regexp.MustCompile(`^[a-z0-9][a-z0-9.\-]{0,63}$`)
	slugRe    = regexp.MustCompile(`^[A-Za-z0-9\-]{0,40}$`)
	kosmosRe  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	accountRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.\-]{0,99}$`)
	fontRe    = regexp.MustCompile(`^[A-Za-z0-9 \-]{0,40}$`)
)

func httpURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

// ValidateData checks one data source. Messages are for people.
func ValidateData(d Data) error {
	switch d.Type {
	case "duckdb":
		if d.Path == "" {
			return errors.New("Für eine DuckDB-Datei braucht es den Pfad zur Datei.")
		}
		if !prefixRe.MatchString(d.Schema) {
			return errors.New("Das Schema darf nur Buchstaben, Ziffern und _ enthalten.")
		}
	case "files":
		if d.Path == "" {
			return errors.New("Für einen Ordner mit Dateien braucht es den Pfad zum Ordner.")
		}
		if !schemaRe.MatchString(d.Schema) {
			return errors.New("Das Schema muss mit einem Buchstaben beginnen und darf nur Buchstaben, Ziffern und _ enthalten.")
		}
	case "snowflake":
		sf := d.Snowflake
		switch {
		case sf.Account == "":
			return errors.New("Für Snowflake braucht es das Konto, z. B. myorg-myaccount.")
		case !accountRe.MatchString(sf.Account):
			return errors.New("Das Snowflake-Konto darf nur Buchstaben, Ziffern, - _ und . enthalten, ohne .snowflakecomputing.com.")
		case sf.User == "":
			return errors.New("Für Snowflake braucht es den Benutzer.")
		case sf.Warehouse == "":
			return errors.New("Für Snowflake braucht es das Warehouse, auf dem Lumantic rechnet.")
		case sf.Database == "":
			return errors.New("Für Snowflake braucht es die Datenbank.")
		case sf.Auth != "keypair" && sf.Auth != "token":
			return errors.New("Die Anmeldung bei Snowflake ist «keypair» oder «token».")
		case sf.Auth == "keypair" && sf.KeyFile == "":
			return errors.New("Für die Anmeldung mit Schlüsselpaar braucht es die Schlüsseldatei.")
		}
		if !prefixRe.MatchString(d.Schema) {
			return errors.New("Das Schema darf nur Buchstaben, Ziffern und _ enthalten.")
		}
	case "databricks":
		db := d.Databricks
		switch {
		case !httpURL(db.Host):
			return errors.New("Für Databricks braucht es die Adresse des Workspace, z. B. https://adb-123.4.azuredatabricks.net.")
		case db.Warehouse == "":
			return errors.New("Für Databricks braucht es die ID des SQL-Warehouse.")
		case db.Auth != "oauth" && db.Auth != "token":
			return errors.New("Die Anmeldung bei Databricks ist «oauth» oder «token».")
		case db.Auth == "oauth" && db.ClientID == "":
			return errors.New("Für OAuth braucht es die Client-ID des Service Principal.")
		case db.Catalog != "" && !prefixRe.MatchString(db.Catalog):
			return errors.New("Der Katalog darf nur Buchstaben, Ziffern und _ enthalten.")
		}
		if !prefixRe.MatchString(d.Schema) {
			return errors.New("Das Schema darf nur Buchstaben, Ziffern und _ enthalten.")
		}
	case "windmill":
		if !httpURL(d.Windmill.URL) {
			return errors.New("Für Windmill braucht es die Adresse, z. B. https://windmill.example.ch.")
		}
		if d.Windmill.Workspace == "" || d.Windmill.Describe == "" || d.Windmill.Query == "" {
			return errors.New("Für Windmill braucht es Workspace und die Pfade der beiden Skripte.")
		}
	default:
		return fmt.Errorf("Unbekannte Datenquelle %q. Möglich sind duckdb, files, snowflake, databricks und windmill.", d.Type)
	}
	if len(d.Name) > 80 {
		return errors.New("Der Name der Datenquelle ist zu lang (höchstens 80 Zeichen).")
	}
	return nil
}

// ValidID says whether id can name a further Kosmos.
func ValidID(id string) bool { return id != MainID && kosmosRe.MatchString(id) }

// Validate checks a config before it is saved. Messages are for people.
func Validate(c Config) error {
	if err := ValidateData(c.Data); err != nil {
		return err
	}
	if c.Refresh != nil {
		if err := ValidateRefresh(*c.Refresh); err != nil {
			return err
		}
	}
	if err := ValidateAuth(c.Auth); err != nil {
		return err
	}
	if err := validateRights(c.Rights, c.Data, c.Auth); err != nil {
		return err
	}
	if err := ValidateGrain(c.Grain); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, k := range c.Kosmen {
		switch {
		case !ValidID(k.ID):
			return fmt.Errorf("Ungültige Kosmos-ID %q: Kleinbuchstaben, Ziffern und - sind möglich, %q ist vergeben.", k.ID, MainID)
		case seen[k.ID]:
			return fmt.Errorf("Die Kosmos-ID %q kommt doppelt vor.", k.ID)
		}
		seen[k.ID] = true
		if err := ValidateData(k.Data); err != nil {
			return fmt.Errorf("Kosmos %s: %w", k.ID, err)
		}
		if k.Refresh != nil {
			if err := ValidateRefresh(*k.Refresh); err != nil {
				return fmt.Errorf("Kosmos %s: %w", k.ID, err)
			}
		}
		if err := validateRights(k.Rights, k.Data, c.Auth); err != nil {
			return fmt.Errorf("Kosmos %s: %w", k.ID, err)
		}
		if err := ValidateGrain(k.Grain); err != nil {
			return fmt.Errorf("Kosmos %s: %w", k.ID, err)
		}
	}
	if c.AI.Provider != "anthropic" {
		return fmt.Errorf("Unbekannter KI-Anbieter %q. Möglich ist anthropic.", c.AI.Provider)
	}
	if !modelRe.MatchString(c.AI.Model) {
		return fmt.Errorf("Ungültige Modell-ID %q.", c.AI.Model)
	}
	if c.AI.BaseURL != "" && !httpURL(c.AI.BaseURL) {
		return errors.New("Die Adresse für die KI muss mit http:// oder https:// beginnen.")
	}
	u := c.UI
	for name, v := range map[string]string{"design": u.Design, "motion": u.Motion, "textSize": u.TextSize, "start": u.Start, "lens": u.Lens} {
		if !slugRe.MatchString(v) {
			return fmt.Errorf("Ungültiger Wert für ui.%s.", name)
		}
	}
	if u.Language != "" && u.Language != "de" && u.Language != "en" {
		return errors.New("Die Sprache ist de, en oder leer für die des Browsers.")
	}
	if !fontRe.MatchString(u.Font) {
		return errors.New("Ungültige Schrift.")
	}
	if u.Accent != "" && !colorRe.MatchString(u.Accent) {
		return errors.New("Der Akzent muss eine Farbe sein, z. B. #4a4ec2.")
	}
	return nil
}

// ValidateBrand is strict: it is used when someone saves the brand section.
// A hand-edited file with mistakes still loads; the mistakes are dropped.
func ValidateBrand(b Brand) error {
	if _, problems := SanitizeBrand(b); len(problems) > 0 {
		return errors.New(strings.Join(problems, " "))
	}
	return nil
}
