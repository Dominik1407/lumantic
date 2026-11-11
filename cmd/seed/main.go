// Command seed builds the demo gold layers "Retail Banking" (weekly) and
// "ALCO" (monthly and daily): one CSV per table plus goldlayer/gold.duckdb,
// whose table and column comments are the data catalog Lumantic reads. It also
// writes "Firmenkunden" and "Privatkunden" as plain folders of CSV files
// (kosmen.go). All figures are invented.
package main

import (
	"encoding/csv"
	"flag"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type column struct{ name, typ, desc string }

type table struct {
	name, desc string
	cols       []column
	rows       [][]string
}

// Fourteen weeks, KW 32 to KW 45 of 2026. Index 13 is the latest week.
var weeks = func() []string {
	start := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	out := make([]string, 14)
	for i := range out {
		out[i] = start.AddDate(0, 0, 7*i).Format("2006-01-02")
	}
	return out
}()

var (
	branches = []string{"Zürich", "Bern", "Basel", "Luzern"}
	shares   = []float64{0.37, 0.26, 0.22, 0.15}
)

func main() {
	dir := flag.String("dir", "goldlayer", "output directory")
	duckdb := flag.String("duckdb", "duckdb", "path to the DuckDB CLI")
	folders := flag.Bool("folders", false, "write only the CSV folders (Firmenkunden, Privatkunden, Industrie), not the DuckDB file")
	flag.Parse()
	if *folders {
		writeFolders(*dir)
		return
	}

	layers := []struct {
		schema, folder string
		tables         []table
	}{
		{"gold_retail", "retail", []table{newCustomers(), costs(), loanApplications(), feedback(), mortgages(), counters()}},
		{"gold_alco", "alco", alcoTables()},
	}

	var script strings.Builder
	count := 0
	for _, l := range layers {
		if err := os.MkdirAll(filepath.Join(*dir, l.folder), 0o755); err != nil {
			log.Fatal(err)
		}
		fmt.Fprintf(&script, "CREATE SCHEMA IF NOT EXISTS %s;\n", l.schema)
		for _, t := range l.tables {
			if err := writeCSV(filepath.Join(*dir, l.folder, t.name+".csv"), t); err != nil {
				log.Fatal(err)
			}
			types := make([]string, len(t.cols))
			for i, c := range t.cols {
				types[i] = fmt.Sprintf("'%s': '%s'", c.name, c.typ)
			}
			fmt.Fprintf(&script, "CREATE OR REPLACE TABLE %s.%s AS SELECT * FROM read_csv('%s/%s.csv', header = true, columns = {%s});\n",
				l.schema, t.name, l.folder, t.name, strings.Join(types, ", "))
			fmt.Fprintf(&script, "COMMENT ON TABLE %s.%s IS %s;\n", l.schema, t.name, lit(t.desc))
			for _, c := range t.cols {
				fmt.Fprintf(&script, "COMMENT ON COLUMN %s.%s.%s IS %s;\n", l.schema, t.name, c.name, lit(c.desc))
			}
			count++
		}
	}

	db := filepath.Join(*dir, "gold.duckdb")
	os.Remove(db)
	os.Remove(db + ".wal")
	cmd := exec.Command(*duckdb, "gold.duckdb")
	cmd.Dir = *dir
	cmd.Stdin = strings.NewReader(script.String())
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Fatalf("duckdb: %v\n%s", err, out)
	}
	log.Printf("Goldlayer gebaut: %s (%d Tabellen)", db, count)

	writeFolders(*dir)
}

// writeFolders writes the gold layers kept as plain folders of CSV files, for
// the further Kosmen.
func writeFolders(dir string) {
	for _, l := range folderLayers() {
		if err := os.MkdirAll(filepath.Join(dir, l.folder), 0o755); err != nil {
			log.Fatal(err)
		}
		for _, t := range l.tables {
			if err := writeCSV(filepath.Join(dir, l.folder, t.name+".csv"), t); err != nil {
				log.Fatal(err)
			}
		}
		log.Printf("Goldlayer gebaut: %s (%d CSV-Dateien)", filepath.Join(dir, l.folder), len(l.tables))
	}
}

func lit(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func writeCSV(path string, t table) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := csv.NewWriter(f)
	head := make([]string, len(t.cols))
	for i, c := range t.cols {
		head[i] = c.name
	}
	w.Write(head)
	w.WriteAll(t.rows)
	return w.Error()
}

// split distributes an integer total over the branches; the last branch takes the rounding rest.
func split(total int) []int {
	out := make([]int, len(shares))
	rest := total
	for i := range shares[:len(shares)-1] {
		out[i] = int(math.Round(float64(total) * shares[i]))
		rest -= out[i]
	}
	out[len(out)-1] = rest
	return out
}

func itoa(v int) string               { return strconv.Itoa(v) }
func ftoa(v float64, prec int) string { return strconv.FormatFloat(v, 'f', prec, 64) }

func newCustomers() table {
	total := []int{128, 131, 126, 135, 140, 133, 138, 142, 139, 137, 140, 148, 151, 149}
	t := table{name: "neukunden", desc: "Neu eröffnete Kundenbeziehungen pro Woche und Filiale",
		cols: []column{
			{"woche", "DATE", "Kalenderwoche, angegeben als Montag der Woche"},
			{"filiale", "VARCHAR", "Filiale, in der die Kundenbeziehung eröffnet wurde"},
			{"neukunden", "INTEGER", "Anzahl neu eröffneter Kundenbeziehungen"},
		}}
	for i, w := range weeks {
		for b, v := range split(total[i]) {
			t.rows = append(t.rows, []string{w, branches[b], itoa(v)})
		}
	}
	return t
}

func costs() table {
	type line struct {
		center, category string
		budget           int
		actual           []int
	}
	lines := []line{
		{"IT", "Lizenzen", 40, []int{38, 39, 38, 40, 40, 39, 41, 40, 41, 42, 43, 52, 41, 40}},
		{"IT", "Hardware", 30, []int{29, 30, 29, 30, 31, 30, 31, 30, 31, 31, 30, 31, 31, 30}},
		{"IT", "Dienstleister", 30, []int{29, 29, 30, 29, 30, 31, 30, 30, 29, 30, 30, 29, 29, 29}},
		{"Marketing", "Kampagnen", 35, []int{33, 36, 34, 35, 37, 32, 35, 34, 36, 35, 33, 34, 35, 36}},
		{"Marketing", "Sponsoring", 15, []int{15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 27}},
		{"Personal", "Löhne", 300, []int{298, 301, 299, 300, 302, 298, 300, 301, 299, 300, 302, 299, 301, 300}},
		{"Raum", "Miete", 60, []int{60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60}},
	}
	t := table{name: "kosten", desc: "Ist-Kosten und Budget pro Woche, Kostenstelle und Kategorie",
		cols: []column{
			{"woche", "DATE", "Kalenderwoche, angegeben als Montag der Woche"},
			{"kostenstelle", "VARCHAR", "Kostenstelle, z. B. IT oder Marketing"},
			{"kategorie", "VARCHAR", "Kostenkategorie innerhalb der Kostenstelle"},
			{"ist_chf", "DOUBLE", "Tatsächlich angefallene Kosten in CHF"},
			{"budget_chf", "DOUBLE", "Budgetierte Kosten in CHF"},
		}}
	for i, w := range weeks {
		for _, l := range lines {
			t.rows = append(t.rows, []string{w, l.center, l.category, itoa(l.actual[i] * 1000), itoa(l.budget * 1000)})
		}
	}
	return t
}

func loanApplications() table {
	received := []int{88, 92, 85, 95, 90, 93, 97, 91, 94, 99, 96, 98, 121, 118}
	approved := []int{70, 74, 69, 76, 73, 75, 78, 74, 76, 80, 77, 79, 82, 88}
	open := [][]int{
		{13, 14, 13, 15, 14, 14, 15, 14, 15, 16, 15, 15, 31, 40},
		{9, 10, 9, 10, 9, 10, 11, 10, 10, 11, 11, 11, 13, 14},
		{8, 8, 8, 9, 8, 9, 9, 8, 9, 9, 9, 10, 10, 12},
		{5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 6, 6, 7, 8},
	}
	t := table{name: "kreditantraege", desc: "Kreditanträge pro Woche und Filiale: Eingang, Bewilligungen und offene Fälle",
		cols: []column{
			{"woche", "DATE", "Kalenderwoche, angegeben als Montag der Woche"},
			{"filiale", "VARCHAR", "Filiale, die den Antrag bearbeitet"},
			{"eingegangen", "INTEGER", "Neu eingegangene Kreditanträge"},
			{"bewilligt", "INTEGER", "Bewilligte Kreditanträge"},
			{"offen", "INTEGER", "Am Wochenende noch offene, unbearbeitete Anträge"},
		}}
	for i, w := range weeks {
		r, a := split(received[i]), split(approved[i])
		for b := range branches {
			t.rows = append(t.rows, []string{w, branches[b], itoa(r[b]), itoa(a[b]), itoa(open[b][i])})
		}
	}
	return t
}

func feedback() table {
	overall := []float64{8.2, 8.1, 8.2, 8.3, 8.2, 8.1, 8.2, 8.3, 8.2, 8.1, 8.2, 8.1, 7.9, 7.6}
	offset := []float64{0, 0.1, -0.1, 0}
	answers := []int{120, 80, 70, 50}
	t := table{name: "kundenfeedback", desc: "Kundenzufriedenheit aus der wöchentlichen Kurzumfrage, pro Filiale",
		cols: []column{
			{"woche", "DATE", "Kalenderwoche, angegeben als Montag der Woche"},
			{"filiale", "VARCHAR", "Filiale, die bewertet wurde"},
			{"zufriedenheit_score", "DOUBLE", "Durchschnittliche Zufriedenheit auf einer Skala von 1 bis 10"},
			{"antworten", "INTEGER", "Anzahl Antworten in der Umfrage"},
		}}
	for i, w := range weeks {
		for b := range branches {
			t.rows = append(t.rows, []string{w, branches[b], ftoa(overall[i]+offset[b], 2), itoa(answers[b])})
		}
	}
	return t
}

func mortgages() table {
	actual := []float64{11.8, 12.3, 11.5, 12.1, 12.4, 11.9, 12.2, 12.0, 11.7, 12.3, 12.1, 14.2, 12.4, 12.1}
	t := table{name: "hypotheken", desc: "Hypothekar-Neugeschäft und Plan pro Woche und Filiale",
		cols: []column{
			{"woche", "DATE", "Kalenderwoche, angegeben als Montag der Woche"},
			{"filiale", "VARCHAR", "Filiale, die das Geschäft abgeschlossen hat"},
			{"neugeschaeft_chf", "DOUBLE", "Volumen neu abgeschlossener Hypotheken in CHF"},
			{"plan_chf", "DOUBLE", "Geplantes Hypothekar-Neugeschäft in CHF"},
		}}
	for i, w := range weeks {
		for b := range branches {
			t.rows = append(t.rows, []string{w, branches[b],
				ftoa(math.Round(actual[i]*shares[b]*1e6), 0), ftoa(math.Round(12*shares[b]*1e6), 0)})
		}
	}
	return t
}

func counters() table {
	overall := []float64{4.1, 4.3, 4.0, 4.2, 4.4, 4.1, 4.2, 4.3, 4.0, 4.2, 4.1, 4.2, 4.3, 4.3}
	offset := []float64{0.6, -0.2, -0.1, -0.3}
	t := table{name: "schalter", desc: "Durchschnittliche Wartezeit am Schalter pro Woche und Filiale",
		cols: []column{
			{"woche", "DATE", "Kalenderwoche, angegeben als Montag der Woche"},
			{"filiale", "VARCHAR", "Filiale mit Schalterbetrieb"},
			{"wartezeit_min", "DOUBLE", "Durchschnittliche Wartezeit in Minuten"},
		}}
	for i, w := range weeks {
		for b := range branches {
			t.rows = append(t.rows, []string{w, branches[b], ftoa(overall[i]+offset[b], 2)})
		}
	}
	return t
}
