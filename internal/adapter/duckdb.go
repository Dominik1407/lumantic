package adapter

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/Dominik1407/lumantic/internal/catalog"
)

// DuckDB reads a database file, opened read-only for each query and closed
// after it, so a loading job can write the file in between (engine.go).
type DuckDB struct {
	Bin    string // path to the DuckDB CLI; "" = the DuckDB built into the program
	DB     string // path to the database file
	Source string // human name of the gold layer
	Schema string // schema prefix to expose, e.g. "gold"
	slots  chan struct{}
}

func NewDuckDB(bin, db, source, schema string) *DuckDB {
	return &DuckDB{Bin: bin, DB: db, Source: source, Schema: schema, slots: make(chan struct{}, 4)}
}

func (d *DuckDB) Name() string    { return "duckdb" }
func (d *DuckDB) Dialect() string { return "duckdb" }

func (d *DuckDB) Query(ctx context.Context, sql string) ([]Row, error) {
	if _, err := os.Stat(d.DB); errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("Die Datenbank %s gibt es nicht.", d.DB)
	}
	return runDuckDB(ctx, d.slots, d.Bin, d.DB, sql)
}

// Mark is the size and time of the database file and of its write-ahead log.
func (d *DuckDB) Mark(context.Context) (string, error) {
	st, err := os.Stat(d.DB)
	if err != nil {
		return "", err
	}
	mark := fmt.Sprintf("%d·%d", st.Size(), st.ModTime().UnixNano())
	if wal, err := os.Stat(d.DB + ".wal"); err == nil {
		mark += fmt.Sprintf("·%d·%d", wal.Size(), wal.ModTime().UnixNano())
	}
	return mark, nil
}

func (d *DuckDB) Describe(ctx context.Context) (*catalog.Catalog, error) {
	rows, err := d.Query(ctx, fmt.Sprintf(`
SELECT t.schema_name, t.table_name, t.comment AS table_comment,
       c.column_name, c.data_type, c.comment AS column_comment
FROM duckdb_tables() t
JOIN duckdb_columns() c USING (database_name, schema_name, table_name)
WHERE t.schema_name LIKE '%s%%'
ORDER BY t.schema_name, t.table_name, c.column_index`, strings.ReplaceAll(d.Schema, "'", "''")))
	if err != nil {
		return nil, err
	}
	cat := &catalog.Catalog{Source: d.Source, Dialect: d.Dialect()}
	AddColumns(cat, rows)
	return cat, LoadDimensionValues(ctx, d.Query, cat, DialectOf(d))
}

// AddColumns turns rows of (schema_name, table_name, column_name, data_type,
// table_comment?, column_comment?) into catalog tables.
func AddColumns(cat *catalog.Catalog, rows []Row) {
	for _, r := range rows {
		name := String(r, "schema_name") + "." + String(r, "table_name")
		t := cat.Table(name)
		if t == nil {
			cat.Tables = append(cat.Tables, catalog.Table{Name: name, Desc: String(r, "table_comment")})
			t = &cat.Tables[len(cat.Tables)-1]
		}
		col := String(r, "column_name")
		t.Columns = append(t.Columns, catalog.Column{
			Name: col,
			Type: String(r, "data_type"),
			Role: catalog.RoleFor(String(r, "data_type")),
			Unit: catalog.UnitFor(col),
			Desc: String(r, "column_comment"),
		})
	}
}

// LoadDimensionValues fetches the distinct values of every text column in one
// query. These are category names (branches, cost centres), not customer data.
func LoadDimensionValues(ctx context.Context, query func(context.Context, string) ([]Row, error), cat *catalog.Catalog, d Dialect) error {
	var cols []Column
	for _, t := range cat.Tables {
		for _, c := range t.Columns {
			if c.Role == catalog.RoleDimension {
				cols = append(cols, Column{Table: t.Name, Column: c.Name})
			}
		}
	}
	if len(cols) == 0 {
		return nil
	}
	rows, err := query(ctx, d.Values(cols))
	if err != nil {
		return err
	}
	for _, r := range rows {
		if t := cat.Table(String(r, "t")); t != nil {
			if c := t.Column(String(r, "c")); c != nil {
				c.Values = append(c.Values, String(r, "v"))
			}
		}
	}
	return nil
}

// The quoting helpers below speak DuckDB; other databases go through their Dialect.

func QuoteIdent(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

func QuoteTable(name string) string {
	parts := strings.Split(name, ".")
	for i, p := range parts {
		parts[i] = QuoteIdent(p)
	}
	return strings.Join(parts, ".")
}

func QuoteLiteral(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
