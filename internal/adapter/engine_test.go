package adapter

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

// Both ways of running DuckDB, built in and CLI, must behave alike: the core
// extensions are there without loading anything, a database file is only
// read, values come back the same, and the memory limit holds.
func TestDuckDBReadsAlikeBothWays(t *testing.T) {
	bin := duckdbBin(t)
	ctx := context.Background()
	slots := make(chan struct{}, 4)

	rows, err := runDuckDB(ctx, slots, bin, "", `SELECT extension_name AS e FROM duckdb_extensions() WHERE loaded AND extension_name IN ('parquet', 'json', 'icu') ORDER BY 1;`)
	if err != nil {
		t.Fatal(err)
	}
	var loaded []string
	for _, r := range rows {
		loaded = append(loaded, String(r, "e"))
	}
	if strings.Join(loaded, ",") != "icu,json,parquet" {
		t.Fatalf("core extensions loaded: %v", loaded)
	}

	t.Setenv("LUMANTIC_DUCKDB_MEMORY", "512MB")
	rows, err = runDuckDB(ctx, slots, bin, "", `SELECT current_setting('memory_limit') AS m, current_setting('autoinstall_known_extensions') AS i;`)
	if err != nil {
		t.Fatal(err)
	}
	if m := String(rows[0], "m"); !strings.Contains(m, "MiB") && !strings.Contains(m, "MB") {
		t.Fatalf("memory limit %v", rows)
	}

	file := filepath.ToSlash(filepath.Join(t.TempDir(), "lager.duckdb"))
	write(t, bin, "ATTACH "+QuoteLiteral(file)+" AS g;\nCREATE SCHEMA g.gold;\n"+
		"CREATE TABLE g.gold.monat AS SELECT DATE '2026-01-01' AS monat, CAST(12.5 AS DECIMAL(10,2)) AS wert, CAST(7 AS BIGINT) AS n, 'Zürich' AS filiale;\nDETACH g;")
	d := NewDuckDB(bin, file, "Test", "gold")
	rows, err = d.Query(ctx, `SELECT monat, CAST(wert AS DOUBLE) AS wert, n, filiale FROM gold.monat;`)
	if err != nil {
		t.Fatal(err)
	}
	r := rows[0]
	if String(r, "monat") != "2026-01-01" || String(r, "filiale") != "Zürich" {
		t.Fatalf("text and dates: %v", r)
	}
	if v, ok := Float(r, "wert"); !ok || v != 12.5 {
		t.Fatalf("number: %#v", r["wert"])
	}
	if v, ok := Float(r, "n"); !ok || v != 7 {
		t.Fatalf("bigint: %#v", r["n"])
	}
	if _, err := d.Query(ctx, `CREATE TABLE gold.neu AS SELECT 1 AS x;`); err == nil {
		t.Fatal("a database file must only be read")
	}
	cat, err := d.Describe(ctx)
	if err != nil || cat.Table("gold.monat") == nil {
		t.Fatalf("describe: %v %+v", err, cat)
	}
}
