package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// DuckDB runs in two ways. A program built with a C compiler has it built in
// (duckdb_builtin.go): one fresh database per query, inside the process, from
// the library the driver ships. Without one, or when a path to the DuckDB CLI
// is set, each query is a CLI process. Both read only, both run at most four
// queries at once, both keep to the same memory limit and never load an
// extension from the internet.

// builtIn runs a query in the DuckDB built into the program; nil when the
// program was built without it.
var builtIn func(ctx context.Context, db, sql string) ([]Row, error)

// BuiltIn says whether this program has DuckDB built in.
func BuiltIn() bool { return builtIn != nil }

// MemoryLimit is how much memory one query may use, as DuckDB writes it.
// LUMANTIC_DUCKDB_MEMORY changes it.
func MemoryLimit() string {
	if v := strings.TrimSpace(os.Getenv("LUMANTIC_DUCKDB_MEMORY")); v != "" {
		return v
	}
	return "2GB"
}

// settings come first in every session: the memory limit, and no extension
// that is not already in the program.
func settings() string {
	return fmt.Sprintf("SET memory_limit = %s;\nSET autoinstall_known_extensions = false;\nSET autoload_known_extensions = false;\n", QuoteLiteral(MemoryLimit()))
}

// runDuckDB runs sql in DuckDB, in a database file opened read-only or, with
// db "", in an empty database in memory. bin is the CLI; "" means built in.
// slots limits how many queries run at once.
func runDuckDB(ctx context.Context, slots chan struct{}, bin, db, sql string) ([]Row, error) {
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if bin == "" {
		if builtIn == nil {
			return nil, fmt.Errorf("Das DuckDB-Programm wurde nicht gefunden (%s). Installieren mit «winget install DuckDB.cli» oder den Pfad unter Daten eintragen.", "duckdb")
		}
		return builtIn(ctx, db, settings()+sql)
	}
	args := []string{"-json"}
	if db != "" {
		args = []string{"-readonly", "-json", db}
	}
	return runCLI(ctx, bin, args, settings()+sql)
}

// runCLI feeds sql to one DuckDB CLI process and parses its JSON output.
func runCLI(ctx context.Context, bin string, args []string, sql string) ([]Row, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Stdin = strings.NewReader(sql)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(string(out))
		}
		return nil, fmt.Errorf("duckdb: %v: %s", err, msg)
	}
	out = bytes.TrimSpace(out)
	if len(out) == 0 {
		return []Row{}, nil
	}
	var rows []Row
	if err := json.Unmarshal(out, &rows); err != nil {
		return nil, fmt.Errorf("duckdb: unreadable result: %w", err)
	}
	return rows, nil
}
