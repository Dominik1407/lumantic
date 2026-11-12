//go:build cgo

package adapter

import (
	"context"
	"database/sql"
	"fmt"
	"math/big"
	"strings"
	"time"

	duckdb "github.com/duckdb/duckdb-go/v2"
)

// With a C compiler, DuckDB is built into the program: the driver links the
// library with its core extensions (Parquet, JSON, ICU) statically, so nothing
// needs installing and nothing is loaded from the internet.
func init() { builtIn = runBuiltIn }

// runBuiltIn opens a database for one query and closes it after: a file
// read-only, so a loading job is never kept out of it for long, or an empty one
// in memory. A cancelled context interrupts the query.
func runBuiltIn(ctx context.Context, db, query string) ([]Row, error) {
	dsn := ""
	if db != "" {
		dsn = db + "?access_mode=read_only"
	}
	conn, err := duckdb.NewConnector(dsn, nil)
	if err != nil {
		return nil, fmt.Errorf("duckdb: %w", err)
	}
	sdb := sql.OpenDB(conn) // closing it closes the connector
	defer sdb.Close()
	rows, err := sdb.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("duckdb: %w", err)
	}
	defer rows.Close()
	cols, err := rows.ColumnTypes()
	if err != nil {
		return nil, fmt.Errorf("duckdb: %w", err)
	}
	out := []Row{}
	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return nil, fmt.Errorf("duckdb: %w", err)
		}
		r := make(Row, len(cols))
		for i, c := range cols {
			r[c.Name()] = plain(vals[i], c.DatabaseTypeName())
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("duckdb: %w", err)
	}
	return out, nil
}

// plain turns a value of the driver into what the CLI's JSON gives for it, so
// both ways read the same: numbers as float64, dates and times as text. (The
// CLI writes decimals as text; Lumantic's own queries sum as DOUBLE.)
func plain(v any, typ string) any {
	switch x := v.(type) {
	case nil, bool, string, float64:
		return x
	case float32:
		return float64(x)
	case int8:
		return float64(x)
	case int16:
		return float64(x)
	case int32:
		return float64(x)
	case int64:
		return float64(x)
	case int:
		return float64(x)
	case uint8:
		return float64(x)
	case uint16:
		return float64(x)
	case uint32:
		return float64(x)
	case uint64:
		return float64(x)
	case *big.Int:
		f, _ := new(big.Float).SetInt(x).Float64()
		return f
	case duckdb.Decimal:
		return x.Float64()
	case time.Time:
		switch {
		case typ == "DATE":
			return x.Format("2006-01-02")
		case typ == "TIME":
			return x.Format("15:04:05.999999")
		case typ == "TIMESTAMPTZ" || strings.Contains(typ, "TIME ZONE"):
			return x.Format("2006-01-02 15:04:05.999999Z07")
		}
		return x.Format("2006-01-02 15:04:05.999999")
	case []byte:
		return string(x)
	case duckdb.UUID:
		return x.String()
	case []any:
		out := make([]any, len(x))
		for i, e := range x {
			out[i] = plain(e, "")
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, e := range x {
			out[k] = plain(e, "")
		}
		return out
	}
	return fmt.Sprint(v)
}
