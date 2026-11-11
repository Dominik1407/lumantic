// Package source builds the data source from the settings. It is the one place
// that turns "DuckDB-Datei", "Ordner mit Dateien", Snowflake, Databricks or
// Windmill into an adapter, used at start, when settings are saved and when a
// connection is tested.
package source

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"lumantic/internal/adapter"
	"lumantic/internal/adapter/databricks"
	"lumantic/internal/adapter/snowflake"
	"lumantic/internal/catalog"
	"lumantic/internal/config"
)

// DuckDBBin resolves the DuckDB CLI: the configured path, else PATH.
func DuckDBBin(configured string) (string, error) {
	bin := configured
	if bin == "" {
		bin = "duckdb"
	}
	p, err := exec.LookPath(bin)
	if err != nil {
		return "", fmt.Errorf("Das DuckDB-Programm wurde nicht gefunden (%s). Installieren mit «winget install DuckDB.cli» oder den Pfad unter Daten eintragen.", bin)
	}
	return p, nil
}

// Build creates the adapter for d. secret reads the secrets of the Kosmos at
// hand by key (config.WindmillToken, config.SnowflakeToken …); "" = not set.
func Build(d config.Data, secret func(key string) string) (adapter.Adapter, error) {
	name := d.Name
	if name == "" {
		name = "Goldlayer"
	}
	switch d.Type {
	case "duckdb":
		bin, err := DuckDBBin(d.DuckDB)
		if err != nil {
			return nil, err
		}
		st, err := os.Stat(d.Path)
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("Die Datei %s gibt es nicht.", d.Path)
		}
		if err != nil {
			return nil, err
		}
		if st.IsDir() {
			return nil, fmt.Errorf("%s ist ein Ordner. Für einen Ordner mit Parquet- oder CSV-Dateien die Quelle «Ordner» wählen.", d.Path)
		}
		return adapter.NewDuckDB(bin, d.Path, name, d.Schema), nil
	case "files":
		bin, err := DuckDBBin(d.DuckDB)
		if err != nil {
			return nil, err
		}
		schema := d.Schema
		if schema == "" {
			schema = "gold"
		}
		f := adapter.NewFiles(bin, d.Path, schema, name)
		return f, nil
	case "snowflake":
		sf := d.Snowflake
		a := &snowflake.Snowflake{Account: sf.Account, User: sf.User, Role: sf.Role, Warehouse: sf.Warehouse,
			Database: sf.Database, Schema: d.Schema, Source: name, Auth: sf.Auth, KeyFile: sf.KeyFile}
		if sf.Auth == "token" {
			if a.Token = secret(config.SnowflakeToken); a.Token == "" {
				return nil, errors.New("Für Snowflake fehlt der Token.")
			}
		} else if _, err := os.Stat(sf.KeyFile); err != nil {
			return nil, fmt.Errorf("Die Schlüsseldatei %s gibt es nicht.", sf.KeyFile)
		}
		return a, nil
	case "databricks":
		db := d.Databricks
		a := &databricks.Databricks{Host: db.Host, Warehouse: db.Warehouse, Catalog: db.Catalog, Schema: d.Schema,
			Source: name, Auth: db.Auth, ClientID: db.ClientID}
		if db.Auth == "token" {
			if a.Token = secret(config.DatabricksToken); a.Token == "" {
				return nil, errors.New("Für Databricks fehlt das persönliche Token.")
			}
		} else if a.ClientSecret = secret(config.DatabricksSecret); a.ClientSecret == "" {
			return nil, errors.New("Für Databricks fehlt das Secret des Service Principal.")
		}
		return a, nil
	case "windmill":
		tok := secret(config.WindmillToken)
		if tok == "" {
			return nil, errors.New("Für Windmill fehlt der Token.")
		}
		return &adapter.Windmill{BaseURL: d.Windmill.URL, Workspace: d.Windmill.Workspace, Token: tok,
			DescribePath: d.Windmill.Describe, QueryPath: d.Windmill.Query}, nil
	}
	return nil, fmt.Errorf("Unbekannte Datenquelle %q.", d.Type)
}

// TableInfo describes one table for the connection test.
type TableInfo struct {
	Name    string           `json:"name"`
	Time    string           `json:"time"` // the time column, "" if none
	Rows    int64            `json:"rows"` // -1 if unknown
	Columns []catalog.Column `json:"columns"`
}

// Inspect reads the catalog and counts the rows of every table in one query.
func Inspect(ctx context.Context, ad adapter.Adapter) (*catalog.Catalog, []TableInfo, error) {
	cat, err := ad.Describe(ctx)
	if err != nil {
		return nil, nil, err
	}
	infos := make([]TableInfo, 0, len(cat.Tables))
	var names []string
	for _, t := range cat.Tables {
		info := TableInfo{Name: t.Name, Rows: -1, Columns: t.Columns}
		if tc := t.TimeColumn(); tc != nil {
			info.Time = tc.Name
		}
		if info.Columns == nil {
			info.Columns = []catalog.Column{}
		}
		infos = append(infos, info)
		names = append(names, t.Name)
	}
	if len(names) > 0 {
		if rows, err := ad.Query(ctx, adapter.DialectOf(ad).Counts(names)); err == nil {
			for _, r := range rows {
				n, _ := adapter.Float(r, "n")
				for i := range infos {
					if infos[i].Name == adapter.String(r, "t") {
						infos[i].Rows = int64(n)
					}
				}
			}
		}
	}
	return cat, infos, nil
}

// Explain turns a low-level error into a sentence for the settings page.
func Explain(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "Cannot open database") || strings.Contains(msg, "database does not exist"):
		return "Die DuckDB-Datei lässt sich nicht öffnen: " + msg
	case strings.Contains(msg, "No files found") || strings.Contains(msg, "No such file"):
		return "Eine Datei im Ordner lässt sich nicht lesen: " + msg
	}
	return msg
}
