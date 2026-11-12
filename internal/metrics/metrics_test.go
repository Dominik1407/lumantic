package metrics

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/catalog"
)

func TestDefaultParses(t *testing.T) {
	c := Default()
	if len(c.KPIs) != 11 || len(c.Groups) != 5 {
		t.Fatalf("got %d figures in %d groups", len(c.KPIs), len(c.Groups))
	}
}

func TestCheckRejectsBrokenDefinitions(t *testing.T) {
	for name, raw := range map[string]string{
		"unknown group": `{"groups":[{"id":"a"}],"kpis":[{"id":"x","group":"b","unit":"%","kind":"stock","monthly":{"table":"t","value":"v"}}]}`,
		"bad unit":      `{"groups":[{"id":"a"}],"kpis":[{"id":"x","group":"a","unit":"CHF","kind":"stock","monthly":{"table":"t","value":"v"}}]}`,
		"ratio of one":  `{"groups":[{"id":"a"}],"kpis":[{"id":"x","group":"a","unit":"%","kind":"stock","monthly":{"table":"t","value":"v"},"parts":{"mode":"ratio","columns":[{"name":"a","column":"a"}]}}]}`,
	} {
		if _, err := parse([]byte(raw)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func testCatalog() *catalog.Catalog {
	return &catalog.Catalog{Tables: []catalog.Table{
		{Name: "g.monat", Columns: []catalog.Column{{Name: "monat", Role: catalog.RoleTime}, {Name: "wert"}, {Name: "a"}, {Name: "b"}}},
		{Name: "g.fluss", Columns: []catalog.Column{{Name: "monat", Role: catalog.RoleTime}, {Name: "segment", Role: catalog.RoleDimension}, {Name: "betrag"}}},
	}}
}

func TestValidateNamesMissingColumns(t *testing.T) {
	c := &Config{Groups: []Group{{ID: "a"}}, KPIs: []Def{{ID: "x", Group: "a", Monthly: Source{Table: "g.monat", Value: "fehlt"}}}}
	err := c.Validate(testCatalog())
	if err == nil || !strings.Contains(err.Error(), "g.monat.fehlt") {
		t.Fatalf("got %v", err)
	}
}

// fake answers each query with rows for the table it names. Queries come side
// by side, so it notes them under a lock.
type fake struct {
	mu      sync.Mutex
	queries []string
}

func (f *fake) Name() string                                       { return "fake" }
func (f *fake) Dialect() string                                    { return "duckdb" }
func (f *fake) Describe(context.Context) (*catalog.Catalog, error) { return testCatalog(), nil }
func (f *fake) Query(_ context.Context, sql string) ([]adapter.Row, error) {
	f.mu.Lock()
	f.queries = append(f.queries, sql)
	f.mu.Unlock()
	if strings.Contains(sql, `"g"."fluss"`) && !strings.Contains(sql, "AS s") {
		return []adapter.Row{{"p": "2026-01", "c0": 3.0}, {"p": "2026-03", "c0": 4.0}}, nil
	}
	if strings.Contains(sql, `"g"."fluss"`) {
		return []adapter.Row{
			{"p": "2026-01", "s": "Privat", "c0": 5.0}, {"p": "2026-01", "s": "Firmen", "c0": -2.0},
			{"p": "2026-03", "s": "Privat", "c0": 4.0},
		}, nil
	}
	return []adapter.Row{{"p": "2026-01", "c0": 10.0, "c1": 6.0, "c2": 4.0}, {"p": "2026-02", "c0": 11.0, "c1": 7.0, "c2": 4.0}, {"p": "2026-03", "c0": 12.0, "c1": 7.0, "c2": 5.0}}, nil
}

func TestLoadBuildsAlignedSeries(t *testing.T) {
	c := &Config{
		Groups: []Group{{ID: "a"}},
		KPIs: []Def{
			{ID: "x", Group: "a", Unit: "%", Kind: "stock", Monthly: Source{Table: "g.monat", Value: "wert"},
				Parts: &Parts{Mode: "sum", Columns: []PartColumn{{Name: "A", Column: "a"}, {Name: "B", Column: "b"}}}},
			{ID: "y", Group: "a", Unit: "Mio", Kind: "flow", Monthly: Source{Table: "g.fluss", Value: "betrag"},
				Parts: &Parts{Mode: "sum", Split: "segment", Order: []string{"Privat"}}},
		},
		Events: []Event{{Month: "2026-02", Title: "E"}, {Month: "2019-01", Title: "ausserhalb"}},
	}
	ad := &fake{}
	d, err := Load(context.Background(), ad, testCatalog(), c)
	if err != nil {
		t.Fatal(err)
	}
	if len(ad.queries) != 3 {
		t.Errorf("want one query per table and split, got %d", len(ad.queries))
	}
	if strings.Join(d.Months, ",") != "2026-01,2026-02,2026-03" {
		t.Fatalf("months %v", d.Months)
	}
	x, y := d.KPIs[0], d.KPIs[1]
	if *x.Series[2] != 12 || *x.Parts[1].Series[2] != 5 {
		t.Errorf("stock series wrong: %v", x.Series)
	}
	// A month without rows stays a gap; the split order puts known parts first.
	if *y.Series[0] != 3 || y.Series[1] != nil {
		t.Errorf("flow total wrong: %v", y.Series)
	}
	if y.Parts[0].Name != "Privat" || y.Parts[1].Name != "Firmen" || *y.Parts[0].Series[2] != 4 {
		t.Errorf("parts wrong: %+v", y.Parts)
	}
	if len(d.Events) != 1 || d.Events[0].Month != 1 {
		t.Errorf("events %+v", d.Events)
	}
}

func TestMonthAxisFillsGaps(t *testing.T) {
	got := monthAxis(map[string]bool{"2025-11": true, "2026-02": true})
	if strings.Join(got, ",") != "2025-11,2025-12,2026-01,2026-02" {
		t.Fatalf("got %v", got)
	}
}

func TestLoadSkipsBrokenFigures(t *testing.T) {
	c := &Config{Groups: []Group{{ID: "a"}}, KPIs: []Def{
		{ID: "x", Group: "a", Unit: "%", Kind: "stock", Monthly: Source{Table: "g.monat", Value: "wert"}},
		{ID: "kaputt", Group: "a", Unit: "%", Kind: "stock", Monthly: Source{Table: "g.fehlt", Value: "wert"}},
	}}
	d, err := Load(context.Background(), &fake{}, testCatalog(), c)
	if err != nil || len(d.KPIs) != 1 || d.KPIs[0].ID != "x" {
		t.Fatalf("got %v %v", d, err)
	}
	c.KPIs = c.KPIs[1:]
	if _, err := Load(context.Background(), &fake{}, testCatalog(), c); err == nil || !strings.Contains(err.Error(), "g.fehlt") {
		t.Fatalf("with none usable: %v", err)
	}
}

func TestPrepareAddsGroupAndChecks(t *testing.T) {
	c := &Config{Groups: []Group{{ID: "a", Name: "A"}}}
	d, err := c.Prepare(Input{Def: Def{Name: "Kredit-Volumen (CHF)", Unit: "Mio", Kind: "stock", Monthly: Source{Table: "g.monat", Value: "wert"}}, GroupName: "Kredite"}, testCatalog())
	if err != nil || d.Group != "kredite" || !c.HasGroup("kredite") || d.Short != d.Name {
		t.Fatalf("%+v %v", d, err)
	}
	if Slug("Kredit-Volumen (CHF)") != "kredit-volumen-chf" || Slug("Zinsänderung") != "zinsaenderung" {
		t.Fatal("slug")
	}
	if _, err := c.Prepare(Input{Def: Def{Name: "X", Unit: "Mio", Kind: "stock", Group: "a", Monthly: Source{Table: "g.monat", Value: "nix"}}}, testCatalog()); err == nil {
		t.Fatal("missing column accepted")
	}
	if _, err := c.Prepare(Input{Def: Def{Name: "X", Unit: "CHF", Kind: "stock", Group: "a", Monthly: Source{Table: "g.monat", Value: "wert"}}}, testCatalog()); err == nil {
		t.Fatal("bad unit accepted")
	}
}

// A quarter needs to know how a figure adds up: kinds avg and ratio, and the
// kind of a ratio's parts.
func TestKindsSayHowFiguresAddUp(t *testing.T) {
	ok := `{"groups":[{"id":"a"}],"kpis":[{"id":"x","group":"a","unit":"%","kind":"avg","monthly":{"table":"t","value":"v"}},
		{"id":"y","group":"a","unit":"%","kind":"ratio","monthly":{"table":"t","value":"v"},"parts":{"mode":"ratio","kind":"flow","columns":[{"name":"a","column":"a"},{"name":"b","column":"b"}]}}]}`
	if _, err := parse([]byte(ok)); err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string]string{
		"an unknown kind":         `{"groups":[{"id":"a"}],"kpis":[{"id":"x","group":"a","unit":"%","kind":"median","monthly":{"table":"t","value":"v"}}]}`,
		"a ratio of nothing":      `{"groups":[{"id":"a"}],"kpis":[{"id":"x","group":"a","unit":"%","kind":"ratio","monthly":{"table":"t","value":"v"}}]}`,
		"a ratio of a sum":        `{"groups":[{"id":"a"}],"kpis":[{"id":"x","group":"a","unit":"%","kind":"ratio","monthly":{"table":"t","value":"v"},"parts":{"mode":"sum","columns":[{"name":"a","column":"a"}]}}]}`,
		"parts of a strange kind": `{"groups":[{"id":"a"}],"kpis":[{"id":"x","group":"a","unit":"%","kind":"stock","monthly":{"table":"t","value":"v"},"parts":{"mode":"ratio","kind":"avg","columns":[{"name":"a","column":"a"},{"name":"b","column":"b"}]}}]}`,
	} {
		if _, err := parse([]byte(raw)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
	c := &Config{Groups: []Group{{ID: "a"}}, KPIs: []Def{{ID: "q", Group: "a", Unit: "%", Kind: "ratio", Monthly: Source{Table: "g.monat", Value: "wert"},
		Parts: &Parts{Mode: "ratio", Kind: "flow", Columns: []PartColumn{{Name: "A", Column: "a"}, {Name: "B", Column: "b"}}}}}}
	d, err := Load(context.Background(), &fake{}, testCatalog(), c)
	if err != nil || d.KPIs[0].Kind != "ratio" || d.KPIs[0].PartsKind != "flow" || len(d.KPIs[0].Parts) != 2 {
		t.Fatalf("%v %+v", err, d.KPIs[0])
	}
}
