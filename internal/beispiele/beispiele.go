// Package beispiele makes the example gold layers: ALCO (a bank's asset and
// liability committee), Industrie (the Musterwerk AG), Firmenkunden and
// Privatkunden. All figures are invented. A first start shows ALCO and
// Industrie as Kosmen, written as folders of CSV files beside the settings;
// cmd/seed writes all of them for development.
//
// The examples do not age: their story ends in the month before today, every
// day they are written anew (story.go).
package beispiele

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	defs "github.com/Dominik1407/lumantic/config/beispiele"
	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/metrics"
)

// ALCO is the ALCO gold layer as it stands on the day today.
func ALCO(today time.Time) (ts []Table) {
	at(today, func() { ts = alcoTables() })
	return ts
}

// Folders are Firmenkunden, Privatkunden and Industrie as they stand on the day today.
func Folders(today time.Time) (ls []Layer) {
	at(today, func() { ls = folderLayers() })
	return ls
}

// WriteCSV writes the tables into dir, one CSV file each.
func WriteCSV(dir string, ts []Table) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, t := range ts {
		if err := writeCSV(filepath.Join(dir, t.Name+".csv"), t); err != nil {
			return err
		}
	}
	return nil
}

// example is one Kosmos of a first start.
type example struct {
	ID, Name, Folder, Schema, Defs string
}

// examples are the Kosmen of a first start, Industrie first: Lumantic fits any
// trade, not only banks.
var examples = []example{
	{ID: "industrie", Name: "Industrie", Folder: "industrie", Schema: "gold", Defs: "industrie.json"},
	{ID: "alco", Name: "ALCO", Folder: "alco", Schema: "gold_alco", Defs: "alco.json"},
}

// Config is the configuration of a first start: the examples written to dir
// as its Kosmen, Industrie as the first. Nothing of it is saved until someone
// saves a setting.
func Config(dir string) config.Config {
	c := config.Defaults()
	for i, e := range examples {
		d := config.Data{Type: "files", Name: e.Name, Path: filepath.Join(dir, e.Folder), Schema: e.Schema, Example: true}
		config.NormalizeData(&d)
		m := filepath.Join(dir, e.Defs)
		if i == 0 {
			c.Data, c.Metrics = d, m
			continue
		}
		c.Kosmen = append(c.Kosmen, config.Kosmos{ID: e.ID, Data: d, Metrics: m})
	}
	return c
}

// stampFile says for which day the examples in a folder were written.
const stampFile = "stand.txt"

// Write puts the examples into dir as they stand on the day today: a folder of
// CSV files for each, and its definitions beside it, with the events moved
// along with the story. It writes once a day; changes made to the examples are
// gone the next day.
func Write(dir string, today time.Time) error {
	day := today.Format("2006-01-02")
	if b, err := os.ReadFile(filepath.Join(dir, stampFile)); err == nil && strings.TrimSpace(string(b)) == day {
		return nil
	}
	var err error
	at(today, func() { err = write(dir) })
	if err != nil {
		return fmt.Errorf("Die Beispiele lassen sich nicht schreiben: %w", err)
	}
	return os.WriteFile(filepath.Join(dir, stampFile), []byte(day+"\n"), 0o644)
}

func write(dir string) error {
	layers := map[string][]Table{"alco": alcoTables(), "industrie": industrieTables()}
	for _, e := range examples {
		folder := filepath.Join(dir, e.Folder)
		if err := os.RemoveAll(folder); err != nil {
			return err
		}
		if err := WriteCSV(folder, layers[e.ID]); err != nil {
			return err
		}
		c, err := definitions(e)
		if err != nil {
			return err
		}
		for i := range c.Events {
			c.Events[i].Month = moveMonth(c.Events[i].Month, cal.shift)
		}
		if err := c.Save(filepath.Join(dir, e.Defs)); err != nil {
			return err
		}
	}
	return nil
}

// definitions are the definitions of an example as the program carries them.
func definitions(e example) (*metrics.Config, error) {
	if e.ID == "alco" {
		return metrics.Default(), nil
	}
	raw, err := defs.Files.ReadFile(e.Defs)
	if err != nil {
		return nil, err
	}
	var c metrics.Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// moveMonth moves a month written YYYY-MM by n months.
func moveMonth(m string, n int) string {
	t, err := time.Parse("2006-01", m)
	if err != nil {
		return m
	}
	return t.AddDate(0, n, 0).Format("2006-01")
}
