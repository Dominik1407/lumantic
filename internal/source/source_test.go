package source

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Dominik1407/lumantic/internal/config"
)

// secrets stands in for the secrets of one Kosmos.
func secrets(kv ...string) func(string) string {
	m := map[string]string{}
	for i := 0; i+1 < len(kv); i += 2 {
		m[kv[i]] = kv[i+1]
	}
	return func(key string) string { return m[key] }
}

func TestBuildExplainsWhatIsMissing(t *testing.T) {
	dir := t.TempDir()
	bin, err := os.Executable() // any existing program stands in for the DuckDB CLI
	if err != nil {
		t.Fatal(err)
	}
	sf := config.Snowflake{Account: "org-acc", User: "LUMANTIC", Warehouse: "WH", Database: "GOLD"}
	db := config.Databricks{Host: "https://adb.example", Warehouse: "abc"}
	cases := map[string]struct {
		d    config.Data
		sec  func(string) string
		want string
	}{
		"no file":             {config.Data{Type: "duckdb", Path: filepath.Join(dir, "fehlt.duckdb"), DuckDB: bin}, secrets(), "gibt es nicht"},
		"folder as file":      {config.Data{Type: "duckdb", Path: dir, DuckDB: bin}, secrets(), "Ordner"},
		"no duckdb":           {config.Data{Type: "files", Path: dir, DuckDB: filepath.Join(dir, "kein-duckdb.exe")}, secrets(), "DuckDB-Programm"},
		"windmill tokenless":  {config.Data{Type: "windmill"}, secrets(), "Token"},
		"snowflake no key":    {config.Data{Type: "snowflake", Snowflake: with(sf, "keypair", filepath.Join(dir, "fehlt.p8"))}, secrets(), "Schlüsseldatei"},
		"snowflake tokenless": {config.Data{Type: "snowflake", Snowflake: with(sf, "token", "")}, secrets(), "Token"},
		"databricks no token": {config.Data{Type: "databricks", Databricks: config.Databricks{Host: db.Host, Warehouse: db.Warehouse, Auth: "token"}}, secrets(), "persönliche Token"},
		"databricks no secret": {config.Data{Type: "databricks", Databricks: config.Databricks{Host: db.Host, Warehouse: db.Warehouse, Auth: "oauth", ClientID: "sp"}},
			secrets(config.DatabricksToken, "nicht dieses"), "Secret"},
		"unknown": {config.Data{Type: "excel"}, secrets(), "Unbekannte"},
	}
	for name, c := range cases {
		if _, err := Build(c.d, c.sec); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: got %v", name, err)
		}
	}
	file := filepath.Join(dir, "gold.duckdb")
	os.WriteFile(file, []byte("x"), 0o644)
	ad, err := Build(config.Data{Type: "duckdb", Path: file, DuckDB: bin, Schema: "gold"}, secrets())
	if err != nil || ad.Name() != "duckdb" {
		t.Fatalf("%v %v", ad, err)
	}
	if ad, err := Build(config.Data{Type: "windmill", Windmill: config.Windmill{URL: "https://wm.example"}}, secrets(config.WindmillToken, "tok")); err != nil || ad.Name() != "windmill" {
		t.Fatalf("%v %v", ad, err)
	}
	key := filepath.Join(dir, "lumantic.p8")
	os.WriteFile(key, []byte("-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----\n"), 0o600)
	if ad, err := Build(config.Data{Type: "snowflake", Snowflake: with(sf, "keypair", key)}, secrets()); err != nil || ad.Dialect() != "snowflake" {
		t.Fatalf("%v %v", ad, err)
	}
	if ad, err := Build(config.Data{Type: "databricks", Databricks: config.Databricks{Host: db.Host, Warehouse: db.Warehouse, Auth: "oauth", ClientID: "sp"}},
		secrets(config.DatabricksSecret, "s3cret")); err != nil || ad.Dialect() != "databricks" {
		t.Fatalf("%v %v", ad, err)
	}
}

func with(sf config.Snowflake, auth, keyFile string) config.Snowflake {
	sf.Auth, sf.KeyFile = auth, keyFile
	return sf
}
