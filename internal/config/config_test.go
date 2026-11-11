package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func envOf(m map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestMissingFileGivesDefaults(t *testing.T) {
	dir := t.TempDir()
	m, err := Open(filepath.Join(dir, "lumantic.json"), filepath.Join(dir, "secrets.json"), envOf(nil))
	if err != nil {
		t.Fatal(err)
	}
	c := m.Effective()
	if m.Exists() || c.Data.Type != "duckdb" || c.AI.Model != "claude-opus-5-5" || !c.AI.Enabled || c.UI.Design != "nebel" || !c.UI.Hints {
		t.Fatalf("defaults wrong: %+v", c)
	}
	if len(m.Locked()) != 0 {
		t.Fatalf("nothing should be locked: %v", m.Locked())
	}
}

func TestFileKeepsDefaultsForMissingKeys(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "lumantic.json")
	os.WriteFile(p, []byte(`{"data":{"type":"files","path":"lake"},"ui":{"design":"stein"}}`), 0o644)
	m, err := Open(p, "", envOf(nil))
	if err != nil {
		t.Fatal(err)
	}
	c := m.Effective()
	if c.Data.Type != "files" || c.Data.Path != "lake" || c.Data.Schema != "gold" || c.UI.Design != "stein" || !c.UI.Hints || !c.AI.Enabled {
		t.Fatalf("got %+v", c)
	}
}

func TestEnvWinsAndLocks(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "lumantic.json")
	os.WriteFile(p, []byte(`{"data":{"path":"datei.duckdb"},"ai":{"model":"claude-haiku-5-5"}}`), 0o644)
	m, _ := Open(p, "", envOf(map[string]string{"LUMANTIC_GOLD": "env.duckdb", "LUMANTIC_LUMINA": "beispiel", "ANTHROPIC_API_KEY": "sk-ant-env-0000abcd"}))
	c := m.Effective()
	if c.Data.Path != "env.duckdb" || c.AI.Enabled || c.AI.Model != "claude-haiku-5-5" {
		t.Fatalf("got %+v", c)
	}
	if m.File().Data.Path != "datei.duckdb" {
		t.Fatal("the file value must stay")
	}
	locked := strings.Join(m.Locked(), ",")
	for _, want := range []string{"data.path", "ai.enabled", "ai.token"} {
		if !strings.Contains(locked, want) {
			t.Errorf("%s not locked: %s", want, locked)
		}
	}
	// sending the env value back is fine, changing it is not
	if _, err := m.Merge(map[string]json.RawMessage{"data": json.RawMessage(`{"path":"env.duckdb","name":"Neu"}`)}); err != nil {
		t.Fatalf("unchanged locked value rejected: %v", err)
	}
	_, err := m.Merge(map[string]json.RawMessage{"data": json.RawMessage(`{"path":"anders.duckdb"}`)})
	var le *LockedError
	if !errors.As(err, &le) || le.Env != "LUMANTIC_GOLD" {
		t.Fatalf("want LockedError, got %v", err)
	}
	if _, st, n := m.Secret(AnthropicToken); !st.Set || st.Source != "umgebung" || st.Hint != "abcd" || n != "ANTHROPIC_API_KEY" {
		t.Fatalf("secret status %+v %s", st, n)
	}
	if _, err := m.SetSecret(AnthropicToken, "x"); err == nil {
		t.Fatal("env secret must not be overwritten")
	}
}

func TestMergeSaveRoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "sub", "lumantic.json")
	m, _ := Open(p, "", envOf(nil))
	c, err := m.Merge(map[string]json.RawMessage{
		"ui":     json.RawMessage(`{"design":"kreide","accent":"#2446c9","hints":false}`),
		"status": json.RawMessage(`{"ok":true}`), // echoed fields are ignored
	})
	if err != nil {
		t.Fatal(err)
	}
	if c.UI.Design != "kreide" || c.UI.Motion != "voll" || c.UI.Hints {
		t.Fatalf("merge %+v", c.UI)
	}
	if err := m.Save(c); err != nil {
		t.Fatal(err)
	}
	m2, err := Open(p, "", envOf(nil))
	if err != nil || !m2.Exists() || m2.Effective().UI.Accent != "#2446c9" || m2.Effective().UI.Hints {
		t.Fatalf("round trip: %v %+v", err, m2.Effective().UI)
	}
	bad := c
	bad.Data.Type = "excel"
	if err := m.Save(bad); err == nil {
		t.Fatal("unknown source type must fail")
	}
}

func TestSecretsFile(t *testing.T) {
	dir := t.TempDir()
	sp := filepath.Join(dir, "data", "secrets.json")
	m, _ := Open(filepath.Join(dir, "lumantic.json"), sp, envOf(nil))
	st, err := m.SetSecret(AnthropicToken, "sk-ant-api-1234wxyz")
	if err != nil || !st.Set || st.Hint != "wxyz" || st.Source != "datei" {
		t.Fatalf("%+v %v", st, err)
	}
	raw, _ := os.ReadFile(sp)
	if !strings.Contains(string(raw), "sk-ant-api-1234wxyz") {
		t.Fatal("token not stored")
	}
	m2, _ := Open(filepath.Join(dir, "lumantic.json"), sp, envOf(nil))
	if v, _, _ := m2.Secret(AnthropicToken); v != "sk-ant-api-1234wxyz" {
		t.Fatal("token not read back")
	}
	if st, _ := m2.SetSecret(AnthropicToken, ""); st.Set {
		t.Fatal("empty value must delete")
	}
	if _, err := m2.SetSecret("password", "x"); err == nil {
		t.Fatal("unknown key accepted")
	}
	if _, err := m2.SetSecret(AnthropicToken, "a b"); err == nil {
		t.Fatal("token with a space accepted")
	}
}

func TestSanitizeBrand(t *testing.T) {
	b := Brand{Name: "Musterbank", Logo: "../geheim.svg", Designs: []Design{
		{ID: "musterbank", Name: "Musterbank", Base: "kreide",
			Colors:    map[string]string{"bg": "#ffffff", "ink": "red; background:url(x)", "accent": "#00539f", "unbekannt": "#000"},
			Fonts:     map[string]string{"text": "Source Sans 3", "ui": "x</style>"},
			FontFiles: []FontFile{{Family: "Hausschrift", File: "fonts/haus.woff2"}, {Family: "Böse", File: "../x.woff2"}}},
		{ID: "nebel"},
	}}
	out, problems := SanitizeBrand(b)
	if out.Logo != "" || len(out.Designs) != 1 {
		t.Fatalf("%+v", out)
	}
	d := out.Designs[0]
	if d.Colors["bg"] != "#ffffff" || d.Colors["accent"] != "#00539f" || d.Colors["ink"] != "" || d.Colors["unbekannt"] != "" {
		t.Errorf("colors %v", d.Colors)
	}
	if d.Fonts["text"] != "Source Sans 3" || d.Fonts["ui"] != "" || len(d.FontFiles) != 1 || d.FontFiles[0].Weight != "400" {
		t.Errorf("fonts %v %v", d.Fonts, d.FontFiles)
	}
	if len(problems) < 4 {
		t.Errorf("problems %v", problems)
	}
	if err := ValidateBrand(b); err == nil {
		t.Error("strict validation must fail")
	}
}

func TestExampleConfigIsValid(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "config", "lumantic.example.json"))
	if err != nil {
		t.Skip("example missing:", err)
	}
	c := Defaults()
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	normalize(&c)
	if err := Validate(c); err != nil {
		t.Fatal(err)
	}
	if err := ValidateBrand(c.Brand); err != nil {
		t.Fatal(err)
	}
	if len(c.Brand.Designs) == 0 || c.Brand.Designs[0].ID != "musterbank" {
		t.Fatalf("example design missing: %+v", c.Brand)
	}
	if len(c.Kosmen) != 2 || c.Kosmen[0].ID != "firmenkunden" || c.Kosmen[0].Data.Type != "files" {
		t.Fatalf("example kosmen missing: %+v", c.Kosmen)
	}
}

func TestFurtherKosmenAreChecked(t *testing.T) {
	ok := Defaults()
	ok.Kosmen = []Kosmos{{ID: "retail", Data: Data{Type: "files", Name: " Retail ", Path: "daten/retail"}}}
	normalize(&ok)
	if err := Validate(ok); err != nil {
		t.Fatal(err)
	}
	if k := ok.Kosmen[0]; k.Data.Name != "Retail" || k.Data.Schema != "gold" || ok.Find("retail") != 0 || ok.Find("x") != -1 {
		t.Fatalf("normalize: %+v", k)
	}
	for name, ks := range map[string][]Kosmos{
		"the id of the first":   {{ID: MainID, Data: ok.Data}},
		"an id with a space":    {{ID: "zwei worte", Data: ok.Data}},
		"the same id twice":     {{ID: "a", Data: ok.Data}, {ID: "a", Data: ok.Data}},
		"a source with no path": {{ID: "b", Data: Data{Type: "duckdb", Name: "B"}}},
	} {
		c := Defaults()
		c.Kosmen = ks
		normalize(&c)
		if err := Validate(c); err == nil {
			t.Errorf("%s must be refused", name)
		}
	}
	// A config written before there were Kosmen still loads, with none beside the first.
	dir := t.TempDir()
	path := filepath.Join(dir, "lumantic.json")
	os.WriteFile(path, []byte(`{"data":{"type":"duckdb","path":"gold.duckdb"}}`), 0o644)
	m, err := Open(path, filepath.Join(dir, "secrets.json"), func(string) (string, bool) { return "", false })
	if err != nil || m.File().Kosmen == nil || len(m.File().Kosmen) != 0 {
		t.Fatalf("old config: %v %+v", err, m.File().Kosmen)
	}
}

func TestWarehouseSources(t *testing.T) {
	sf := Data{Type: "Snowflake", Name: " Gold ", Schema: "GOLD", Snowflake: Snowflake{Account: " myorg-acc ", User: "LUMANTIC", Warehouse: "WH_XS", Database: "ANALYTICS", KeyFile: "keys/lumantic.p8"},
		Databricks: Databricks{Host: "left over"}}
	NormalizeData(&sf)
	if sf.Type != "snowflake" || sf.Snowflake.Auth != "keypair" || sf.Snowflake.Account != "myorg-acc" || sf.Databricks != (Databricks{}) {
		t.Fatalf("normalize: %+v", sf)
	}
	if err := ValidateData(sf); err != nil {
		t.Fatal(err)
	}
	db := Data{Type: "databricks", Schema: "gold", Databricks: Databricks{Host: "adb-1.2.azuredatabricks.net/", Warehouse: "abc123", ClientID: "sp-1"}}
	NormalizeData(&db)
	if db.Databricks.Host != "https://adb-1.2.azuredatabricks.net" || db.Databricks.Auth != "oauth" {
		t.Fatalf("normalize: %+v", db.Databricks)
	}
	if err := ValidateData(db); err != nil {
		t.Fatal(err)
	}
	bad := map[string]Data{
		"Konto":                    {Type: "snowflake", Snowflake: Snowflake{User: "u", Warehouse: "w", Database: "d", Auth: "keypair", KeyFile: "k"}},
		"ohne .snowflakecomputing": {Type: "snowflake", Snowflake: Snowflake{Account: "acc.snowflakecomputing.com/x", User: "u", Warehouse: "w", Database: "d", Auth: "keypair", KeyFile: "k"}},
		"Warehouse":                {Type: "snowflake", Snowflake: Snowflake{Account: "a", User: "u", Database: "d", Auth: "keypair", KeyFile: "k"}},
		"Schlüsseldatei":           {Type: "snowflake", Snowflake: Snowflake{Account: "a", User: "u", Warehouse: "w", Database: "d", Auth: "keypair"}},
		"Adresse":                  {Type: "databricks", Databricks: Databricks{Warehouse: "w", Auth: "token"}},
		"SQL-Warehouse":            {Type: "databricks", Databricks: Databricks{Host: "https://x", Auth: "token"}},
		"Client-ID":                {Type: "databricks", Databricks: Databricks{Host: "https://x", Warehouse: "w", Auth: "oauth"}},
		"Schema":                   {Type: "databricks", Schema: "gold; drop", Databricks: Databricks{Host: "https://x", Warehouse: "w", Auth: "token"}},
	}
	for want, d := range bad {
		if err := ValidateData(d); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: got %v", want, err)
		}
	}
	// Only the block of the kind in use is written down.
	raw, _ := json.Marshal(sf)
	if strings.Contains(string(raw), "databricks") || !strings.Contains(string(raw), `"snowflake":{"account":"myorg-acc"`) {
		t.Errorf("json: %s", raw)
	}
	duck, _ := json.Marshal(Defaults().Data)
	if strings.Contains(string(duck), "snowflake") || strings.Contains(string(duck), "databricks") {
		t.Errorf("a DuckDB source should not mention the warehouses: %s", duck)
	}
}

func TestWarehouseSecretsBelongToOneKosmos(t *testing.T) {
	dir := t.TempDir()
	m, err := Open(filepath.Join(dir, "lumantic.json"), filepath.Join(dir, "secrets.json"), envOf(map[string]string{"DATABRICKS_TOKEN": "dapi-from-env-0001"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.SetSecret(KosmosKey(DatabricksToken, "firmenkunden"), "dapi-firmen-0002"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.SetSecret(KosmosKey(SnowflakeToken, "firmenkunden"), "pat-firmen-0003"); err != nil {
		t.Fatal(err)
	}
	if v, _, _ := m.Secret(KosmosKey(DatabricksToken, MainID)); v != "dapi-from-env-0001" {
		t.Errorf("the first Kosmos reads the environment, got %q", v)
	}
	if v, st, _ := m.Secret(KosmosKey(DatabricksToken, "firmenkunden")); v != "dapi-firmen-0002" || st.Source != "datei" {
		t.Errorf("a further Kosmos keeps its own token, got %q %+v", v, st)
	}
	if _, err := m.SetSecret(DatabricksToken, "x"); err == nil {
		t.Error("an environment variable fixes the first Kosmos's token")
	}
	for _, key := range []string{AnthropicToken + "@firmenkunden", DatabricksToken + "@Gross", DatabricksToken + "@main", "password@firmenkunden"} {
		if _, err := m.SetSecret(key, "x"); err == nil {
			t.Errorf("%s should be refused", key)
		}
	}
	if !PerKosmos(SnowflakeToken) || PerKosmos(AnthropicToken) || PerKosmos(WindmillToken) {
		t.Error("PerKosmos is wrong")
	}
	if err := m.DropSecrets("firmenkunden"); err != nil {
		t.Fatal(err)
	}
	if v, _, _ := m.Secret(KosmosKey(SnowflakeToken, "firmenkunden")); v != "" {
		t.Errorf("dropped secret still there: %q", v)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "secrets.json"))
	if strings.Contains(string(raw), "firmenkunden") {
		t.Errorf("secrets file: %s", raw)
	}
}

func TestRefreshSchedules(t *testing.T) {
	files, sf := Data{Type: "files"}, Data{Type: "snowflake"}
	if r := RefreshOf(files, nil); r.Watch != 5 || len(r.Daily) != 0 {
		t.Errorf("files: %+v", r)
	}
	if r := RefreshOf(sf, nil); r.Watch != 0 || len(r.Daily) != 1 || r.Daily[0] != "06:00" {
		t.Errorf("a warehouse wakes once a day: %+v", r)
	}
	if r := RefreshOf(sf, &Refresh{Watch: 5}); r.Watch != 0 {
		t.Errorf("a warehouse is never watched: %+v", r)
	}
	r := &Refresh{Daily: []string{" 7:15", "06:00", "06:00", ""}, Watch: 3}
	normalizeRefresh(r, sf)
	if strings.Join(r.Daily, ",") != "06:00,07:15" || r.Watch != 0 {
		t.Errorf("normalize: %+v", r)
	}
	for _, bad := range []Refresh{{Daily: []string{"24:00"}}, {Daily: []string{"6.30"}}, {Watch: -1}, {Daily: []string{"1:00", "2:00", "3:00", "4:00", "5:00", "6:00", "7:00", "8:00", "9:00"}}} {
		if ValidateRefresh(bad) == nil {
			t.Errorf("should be refused: %+v", bad)
		}
	}
	if err := ValidateRefresh(Refresh{Daily: []string{"00:00", "23:59"}, Watch: 1440}); err != nil {
		t.Error(err)
	}
}
