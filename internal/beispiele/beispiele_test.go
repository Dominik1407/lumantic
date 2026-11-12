package beispiele

import (
	"encoding/csv"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Dominik1407/lumantic/internal/metrics"
)

func readCSV(t *testing.T, path string) [][]string {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	return rows[1:]
}

// Started in a year, the examples still end in the month before today, their
// days run to the last weekday before today, budgets belong to that year,
// December stays December, and the events move with the story.
func TestExamplesDoNotAge(t *testing.T) {
	dir := t.TempDir()
	today := time.Date(2027, 3, 15, 9, 30, 0, 0, time.UTC) // a Monday
	if err := Write(dir, today); err != nil {
		t.Fatal(err)
	}
	kpi := readCSV(t, filepath.Join(dir, "industrie", "kpi_monat.csv"))
	if first, last := kpi[0][0], kpi[len(kpi)-1][0]; first != "2019-05-01" || last != "2027-02-01" {
		t.Fatalf("months %s to %s", first, last)
	}
	days := readCSV(t, filepath.Join(dir, "industrie", "produktion_tag.csv"))
	if last := days[len(days)-1][0]; last != "2027-03-12" {
		t.Fatalf("last day %s, want the Friday before", last)
	}
	alcoDays := readCSV(t, filepath.Join(dir, "alco", "liquiditaet_tag.csv"))
	if last := alcoDays[len(alcoDays)-1][0]; last != "2027-03-12" {
		t.Fatalf("last ALCO day %s", last)
	}
	var budgets []string
	for _, r := range readCSV(t, filepath.Join(dir, "industrie", "lumantic_ziele.csv")) {
		if r[0] == "umsatz" {
			budgets = append(budgets, r[3]+" "+r[4])
		}
	}
	if strings.Join(budgets, ", ") != "Budget 2026 2026-01-01, Budget 2027 2027-01-01" {
		t.Fatalf("budgets %v", budgets)
	}
	// Sales peak in December, wherever the story lands.
	sales := map[string]float64{}
	for _, r := range readCSV(t, filepath.Join(dir, "industrie", "finanzen_monat.csv")) {
		if strings.HasPrefix(r[0], "2024-") {
			v, _ := strconv.ParseFloat(r[2], 64)
			sales[r[0][5:7]] += v
		}
	}
	for m, v := range sales {
		if m != "12" && v >= sales["12"] {
			t.Fatalf("month %s (%.1f) sells more than December (%.1f)", m, v, sales["12"])
		}
	}
	c, err := metrics.LoadFile(filepath.Join(dir, "industrie.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Events) != 1 || c.Events[0].Month != "2026-12" {
		t.Fatalf("events %+v", c.Events)
	}
	a, err := metrics.LoadFile(filepath.Join(dir, "alco.json"))
	if err != nil || len(a.KPIs) == 0 || a.Events[len(a.Events)-1].Month != "2026-12" {
		t.Fatalf("ALCO definitions %v %+v", err, a)
	}

	// Once a day: a second start the same day leaves them as they are.
	os.WriteFile(filepath.Join(dir, "industrie", "kpi_monat.csv"), []byte("monat\n"), 0o644)
	if err := Write(dir, today.Add(5*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "industrie", "kpi_monat.csv")); string(b) != "monat\n" {
		t.Fatal("written twice on one day")
	}
}

// On the story's own day the examples are what they always were.
func TestTheStoryAsWritten(t *testing.T) {
	c := clockFor(storyToday)
	if c.shift != 0 || c.start.Format("2006-01") != "2019-01" || c.last.Format("2006-01-02") != "2026-11-10" {
		t.Fatalf("%+v", c)
	}
}

func TestFirstStartConfig(t *testing.T) {
	c := Config("beispiele")
	if c.Data.Name != "Industrie" || !c.Data.Example || c.Data.Type != "files" || c.Metrics != filepath.Join("beispiele", "industrie.json") {
		t.Fatalf("first Kosmos %+v %s", c.Data, c.Metrics)
	}
	if len(c.Kosmen) != 1 || c.Kosmen[0].ID != "alco" || !c.Kosmen[0].Data.Example || c.Kosmen[0].Data.Schema != "gold_alco" {
		t.Fatalf("further Kosmen %+v", c.Kosmen)
	}
}
