package adapter

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Dominik1407/lumantic/internal/catalog"
)

// Files reads a gold layer kept as files: every .parquet or .csv file in a
// folder (and every subfolder of Parquet files, as written by most lakehouse
// jobs) becomes the view <schema>.<name>. Each query runs in a fresh DuckDB
// database in memory that may read only inside that folder.
type Files struct {
	Bin    string // path to the DuckDB CLI; "" = the DuckDB built into the program
	Dir    string // the folder
	Schema string // schema of the views, e.g. "gold"
	Source string // human name of the gold layer
	slots  chan struct{}
}

func NewFiles(bin, dir, schema, source string) *Files {
	return &Files{Bin: bin, Dir: dir, Schema: schema, Source: source, slots: make(chan struct{}, 4)}
}

func (f *Files) Name() string    { return "files" }
func (f *Files) Dialect() string { return "duckdb" }

type fileTable struct {
	name string // view name
	from string // table function reading the file(s)
}

var identRe = regexp.MustCompile(`[^a-z0-9_]+`)

// viewName turns a file name into a plain SQL name: "Bilanz Monat.csv" → bilanz_monat.
func viewName(file string) string {
	n := strings.ToLower(strings.TrimSuffix(file, filepath.Ext(file)))
	n = strings.NewReplacer("ä", "ae", "ö", "oe", "ü", "ue").Replace(n)
	n = strings.Trim(identRe.ReplaceAllString(n, "_"), "_")
	if n != "" && n[0] >= '0' && n[0] <= '9' {
		n = "t_" + n
	}
	return n
}

func hasParquet(dir string) bool {
	found := false
	filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || found {
			return filepath.SkipDir
		}
		if !d.IsDir() && strings.EqualFold(filepath.Ext(p), ".parquet") {
			found = true
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

func (f *Files) abs() (string, error) {
	dir, err := filepath.Abs(f.Dir)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(dir)
	if errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("Den Ordner %s gibt es nicht.", f.Dir)
	}
	if err != nil {
		return "", err
	}
	if !st.IsDir() {
		return "", fmt.Errorf("%s ist kein Ordner.", f.Dir)
	}
	return dir, nil
}

func (f *Files) tables(dir string) ([]fileTable, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	sort.Slice(entries, func(a, b int) bool { return entries[a].Name() < entries[b].Name() })
	seen := map[string]bool{}
	var out []fileTable
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") {
			continue
		}
		p := filepath.ToSlash(filepath.Join(dir, name))
		var from string
		switch ext := strings.ToLower(filepath.Ext(name)); {
		case e.IsDir() && hasParquet(filepath.Join(dir, name)):
			// One file per day is the usual way a job writes a table; union_by_name keeps
			// the older files readable when a column is added later.
			from = fmt.Sprintf("read_parquet(%s, hive_partitioning = true, union_by_name = true)", QuoteLiteral(p+"/**/*.parquet"))
		case !e.IsDir() && ext == ".parquet":
			from = fmt.Sprintf("read_parquet(%s)", QuoteLiteral(p))
		case !e.IsDir() && ext == ".csv":
			from = fmt.Sprintf("read_csv_auto(%s)", QuoteLiteral(p))
		default:
			continue
		}
		v := viewName(name)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, fileTable{name: v, from: from})
	}
	return out, nil
}

// preamble restricts the process to the folder and defines the views.
func (f *Files) preamble() (string, error) {
	dir, err := f.abs()
	if err != nil {
		return "", err
	}
	tabs, err := f.tables(dir)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "SET allowed_directories = [%s];\nSET enable_external_access = false;\nSET lock_configuration = true;\n",
		QuoteLiteral(filepath.ToSlash(dir)+"/"))
	fmt.Fprintf(&b, "CREATE SCHEMA %s;\n", QuoteIdent(f.Schema))
	for _, t := range tabs {
		fmt.Fprintf(&b, "CREATE VIEW %s.%s AS SELECT * FROM %s;\n", QuoteIdent(f.Schema), QuoteIdent(t.name), t.from)
	}
	return b.String(), nil
}

func (f *Files) Query(ctx context.Context, sql string) ([]Row, error) {
	pre, err := f.preamble()
	if err != nil {
		return nil, err
	}
	return runDuckDB(ctx, f.slots, f.Bin, "", pre+sql)
}

func (f *Files) Describe(ctx context.Context) (*catalog.Catalog, error) {
	rows, err := f.Query(ctx, fmt.Sprintf(`
SELECT table_schema AS schema_name, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = %s
ORDER BY table_name, ordinal_position;`, QuoteLiteral(f.Schema)))
	if err != nil {
		return nil, err
	}
	cat := &catalog.Catalog{Source: f.Source, Dialect: f.Dialect()}
	AddColumns(cat, rows)
	return cat, LoadDimensionValues(ctx, f.Query, cat, DialectOf(f))
}

// Mark sums up the folder: how many table files there are, how big, and the
// newest change. A file added, replaced or removed changes it.
func (f *Files) Mark(ctx context.Context) (string, error) {
	dir, err := f.abs()
	if err != nil {
		return "", err
	}
	var n, size int64
	var newest time.Time
	err = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() || !tableFile(d.Name()) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		n, size = n+1, size+info.Size()
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		return nil
	})
	return fmt.Sprintf("%d·%d·%d", n, size, newest.UnixNano()), err
}

func tableFile(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return (ext == ".parquet" || ext == ".csv") && !strings.HasPrefix(name, ".") && !strings.HasPrefix(name, "_")
}

// Unavailable stands in when no data source can be built, so the app still
// starts and can be set up from its settings.
type Unavailable struct{ Err error }

func (u Unavailable) Name() string    { return "keine" }
func (u Unavailable) Dialect() string { return "duckdb" }
func (u Unavailable) Describe(context.Context) (*catalog.Catalog, error) {
	return nil, u.Err
}
func (u Unavailable) Query(context.Context, string) ([]Row, error) { return nil, u.Err }
