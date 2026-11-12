package adapter

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// duckdbBin says which DuckDB the tests run: "" for the one built into the
// program, else the CLI; without either they skip.
func duckdbBin(t *testing.T) string {
	t.Helper()
	if BuiltIn() {
		return ""
	}
	for _, c := range []string{os.Getenv("LUMANTIC_DUCKDB"), "duckdb",
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Microsoft\WinGet\Packages\DuckDB.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\duckdb.exe`)} {
		if c == "" {
			continue
		}
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	t.Skip("DuckDB CLI not found")
	return ""
}

// write runs sql in an empty DuckDB that may write files, to prepare a test.
func write(t *testing.T, bin, sql string) {
	t.Helper()
	if bin == "" {
		if _, err := builtIn(context.Background(), "", sql+"\nSELECT 1 AS ok;"); err != nil {
			t.Fatalf("preparing: %v", err)
		}
		return
	}
	cmd := exec.Command(bin)
	cmd.Stdin = strings.NewReader(sql)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("preparing: %v %s", err, b)
	}
}

func TestFilesReadsCSVAndParquet(t *testing.T) {
	bin := duckdbBin(t)
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "Bilanz Monat.csv"), []byte("monat,kredite_mio,segment\n2026-01-31,900,Privat\n2026-02-28,910.5,Firmen\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "notizen.txt"), []byte("not a table"), 0o644)
	os.MkdirAll(filepath.Join(dir, "neugeld"), 0o755)
	out := filepath.ToSlash(dir)
	sql := "COPY (SELECT DATE '2026-01-31' + INTERVAL (i) MONTH AS monat, 10.0 * i AS betrag_mio FROM range(3) t(i)) TO '" + out + "/liquiditaet.parquet' (FORMAT parquet);\n" +
		"COPY (SELECT DATE '2026-01-31' AS monat, 5.0 AS betrag_mio) TO '" + out + "/neugeld/part-0.parquet' (FORMAT parquet);\n"
	write(t, bin, sql)

	f := NewFiles(bin, dir, "gold", "Testordner")
	cat, err := f.Describe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, tb := range cat.Tables {
		names = append(names, tb.Name)
	}
	if strings.Join(names, ",") != "gold.bilanz_monat,gold.liquiditaet,gold.neugeld" {
		t.Fatalf("tables %v", names)
	}
	bil := cat.Table("gold.bilanz_monat")
	if tc := bil.TimeColumn(); tc == nil || tc.Name != "monat" {
		t.Fatalf("time column of csv: %+v", bil.Columns)
	}
	if seg := bil.Column("segment"); seg == nil || strings.Join(seg.Values, ",") != "Firmen,Privat" {
		t.Fatalf("dimension values: %+v", seg)
	}
	rows, err := f.Query(context.Background(), `SELECT CAST(SUM(betrag_mio) AS DOUBLE) AS s FROM "gold"."liquiditaet"`)
	if err != nil {
		t.Fatal(err)
	}
	if s, _ := Float(rows[0], "s"); s != 30 {
		t.Fatalf("sum %v", rows)
	}
	// a query may read only inside the folder
	outside := filepath.Join(t.TempDir(), "geheim.csv")
	os.WriteFile(outside, []byte("a\n1\n"), 0o644)
	if _, err := f.Query(context.Background(), "SELECT * FROM read_csv_auto("+QuoteLiteral(filepath.ToSlash(outside))+")"); err == nil {
		t.Fatal("reading outside the folder must fail")
	}
}

func TestFilesMissingFolder(t *testing.T) {
	f := NewFiles("duckdb", filepath.Join(t.TempDir(), "gibtsnicht"), "gold", "x")
	if _, err := f.Describe(context.Background()); err == nil || !strings.Contains(err.Error(), "gibt es nicht") {
		t.Fatalf("got %v", err)
	}
}

func TestViewName(t *testing.T) {
	for in, want := range map[string]string{"Bilanz Monat.csv": "bilanz_monat", "Zinsänderung-2026.parquet": "zinsaenderung_2026", "2026_neugeld.csv": "t_2026_neugeld"} {
		if got := viewName(in); got != want {
			t.Errorf("%s: %s, want %s", in, got, want)
		}
	}
}

// A file added for a new day, or one written again, moves the mark.
func TestFolderMarkMovesWithItsFiles(t *testing.T) {
	dir := t.TempDir()
	day := filepath.Join(dir, "kredite")
	os.MkdirAll(day, 0o755)
	os.WriteFile(filepath.Join(day, "2026-11-10.parquet"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, "notiz.txt"), []byte("egal"), 0o644)
	f := NewFiles("duckdb", dir, "gold", "Test")
	a, err := f.Mark(context.Background())
	if err != nil || a == "" {
		t.Fatalf("%q %v", a, err)
	}
	if b, _ := f.Mark(context.Background()); b != a {
		t.Fatal("the same files must give the same mark")
	}
	os.WriteFile(filepath.Join(dir, "notiz.txt"), []byte("anders"), 0o644)
	if b, _ := f.Mark(context.Background()); b != a {
		t.Fatal("a file that is no table must not count")
	}
	os.WriteFile(filepath.Join(day, "2026-11-11.parquet"), []byte("y"), 0o644)
	b, _ := f.Mark(context.Background())
	if b == a {
		t.Fatal("a new day must move the mark")
	}
	if _, err := NewFiles("duckdb", filepath.Join(dir, "fehlt"), "gold", "Test").Mark(context.Background()); err == nil {
		t.Fatal("a missing folder has no mark")
	}
}
