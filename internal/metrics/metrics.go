// Package metrics turns gold-layer tables into key figures with rules. The
// definitions (what a figure means, where it lives, its limit and target)
// belong to the analysts and live in a JSON file; the numbers stay in the
// gold layer and are read fresh through the adapter.
package metrics

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"lumantic/internal/adapter"
	"lumantic/internal/catalog"
)

//go:embed default.json
var defaultJSON []byte

type Source struct {
	Table string `json:"table"`
	Value string `json:"value"`
}

type PartColumn struct {
	Name   string `json:"name"`
	Column string `json:"column"`
}

// Parts break a figure down, either into columns of the same table or by the
// values of a dimension (split). Mode tells the UI how the parts combine.
type Parts struct {
	Mode    string       `json:"mode"` // "sum", "ratio" (numerator ÷ denominator) or "funnel"
	Columns []PartColumn `json:"columns,omitempty"`
	Split   string       `json:"split,omitempty"`
	Order   []string     `json:"order,omitempty"`
}

type Def struct {
	ID         string   `json:"id"`
	Group      string   `json:"group"`
	Name       string   `json:"name"`
	Long       string   `json:"long"`
	Short      string   `json:"short"`
	Unit       string   `json:"unit"` // "%", "Mio" or "Mrd"; amounts are in Mio. CHF
	Dec        int      `json:"dec"`
	Kind       string   `json:"kind"` // "stock" (balance at month end) or "flow" (sum over the month)
	Dir        int      `json:"dir"`  // 1 higher is better, -1 lower is better, 0 neutral
	Limit      *float64 `json:"limit,omitempty"`
	Target     *float64 `json:"target,omitempty"`
	LimitName  string   `json:"limitName,omitempty"`
	TargetName string   `json:"targetName,omitempty"`
	Desc       string   `json:"desc"`
	Hidden     bool     `json:"hidden,omitempty"`
	Season     bool     `json:"season,omitempty"`
	Monthly    Source   `json:"monthly"`
	Daily      *Source  `json:"daily,omitempty"`
	Parts      *Parts   `json:"parts,omitempty"`
}

type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Event struct {
	Month string `json:"month"` // YYYY-MM
	Title string `json:"title"`
	Text  string `json:"text"`
}

type Config struct {
	Title  string  `json:"title"`
	Source string  `json:"source"`
	Groups []Group `json:"groups"`
	KPIs   []Def   `json:"kpis"`
	Events []Event `json:"events"`
}

// Default returns the built-in ALCO definitions.
func Default() *Config {
	c, err := parse(defaultJSON)
	if err != nil {
		panic(err)
	}
	return c
}

// LoadFile reads definitions from a JSON file; an empty path means the default.
func LoadFile(path string) (*Config, error) {
	if path == "" {
		return Default(), nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parse(raw)
}

func parse(raw []byte) (*Config, error) {
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("Kennzahlen-Definitionen: %w", err)
	}
	return &c, c.check()
}

// check catches definition mistakes that do not need the gold layer.
func (c *Config) check() error {
	groups := map[string]bool{}
	for _, g := range c.Groups {
		groups[g.ID] = true
	}
	seen := map[string]bool{}
	for _, k := range c.KPIs {
		switch {
		case k.ID == "" || seen[k.ID]:
			return fmt.Errorf("Kennzahl %q: ID fehlt oder ist doppelt", k.ID)
		case !groups[k.Group]:
			return fmt.Errorf("Kennzahl %s: unbekannte Gruppe %q", k.ID, k.Group)
		case k.Unit != "%" && k.Unit != "Mio" && k.Unit != "Mrd":
			return fmt.Errorf("Kennzahl %s: Einheit muss %%, Mio oder Mrd sein", k.ID)
		case k.Kind != "stock" && k.Kind != "flow":
			return fmt.Errorf("Kennzahl %s: kind muss stock oder flow sein", k.ID)
		case k.Dir < -1 || k.Dir > 1:
			return fmt.Errorf("Kennzahl %s: dir muss -1, 0 oder 1 sein", k.ID)
		case k.Monthly.Table == "" || k.Monthly.Value == "":
			return fmt.Errorf("Kennzahl %s: monthly.table und monthly.value fehlen", k.ID)
		}
		if p := k.Parts; p != nil {
			if (len(p.Columns) == 0) == (p.Split == "") {
				return fmt.Errorf("Kennzahl %s: parts braucht entweder columns oder split", k.ID)
			}
			if p.Mode == "ratio" && len(p.Columns) != 2 {
				return fmt.Errorf("Kennzahl %s: ratio braucht genau zwei Spalten (Zähler, Nenner)", k.ID)
			}
		}
		seen[k.ID] = true
	}
	for _, e := range c.Events {
		if len(e.Month) != 7 {
			return fmt.Errorf("Ereignis %q: month im Format JJJJ-MM", e.Title)
		}
	}
	return nil
}

// Missing lists what one figure needs from the gold layer but does not find.
func (k Def) Missing(cat *catalog.Catalog) []string {
	var missing []string
	need := func(table, col string) {
		var t *catalog.Table
		if cat != nil {
			t = cat.Table(table)
		}
		switch {
		case t == nil:
			missing = append(missing, table)
		case t.TimeColumn() == nil:
			missing = append(missing, table+" (Zeitspalte)")
		case col != "" && t.Column(col) == nil:
			missing = append(missing, table+"."+col)
		}
	}
	need(k.Monthly.Table, k.Monthly.Value)
	if k.Daily != nil {
		need(k.Daily.Table, k.Daily.Value)
	}
	if k.Parts != nil {
		for _, p := range k.Parts.Columns {
			need(k.Monthly.Table, p.Column)
		}
		if k.Parts.Split != "" {
			need(k.Monthly.Table, k.Parts.Split)
		}
	}
	sort.Strings(missing)
	return dedupe(missing)
}

// Validate checks every referenced table and column against the catalog.
func (c *Config) Validate(cat *catalog.Catalog) error {
	var missing []string
	for _, k := range c.KPIs {
		missing = append(missing, k.Missing(cat)...)
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("im Goldlayer fehlt: %s", strings.Join(dedupe(missing), ", "))
	}
	return nil
}

// usable keeps the figures the gold layer can serve, so one broken definition
// does not hide all the others. With none left, it reports why.
func (c *Config) usable(cat *catalog.Catalog) (*Config, error) {
	out := *c
	out.KPIs = nil
	for _, k := range c.KPIs {
		if len(k.Missing(cat)) == 0 {
			out.KPIs = append(out.KPIs, k)
		}
	}
	if len(out.KPIs) == 0 && len(c.KPIs) > 0 {
		return nil, c.Validate(cat)
	}
	return &out, nil
}

func dedupe(xs []string) []string {
	if len(xs) == 0 {
		return xs
	}
	out := xs[:0]
	for i, x := range xs {
		if i == 0 || x != xs[i-1] {
			out = append(out, x)
		}
	}
	return out
}

// Named is one part of a figure as a series on the shared time axis.
type Named struct {
	Name   string     `json:"name"`
	Series []*float64 `json:"series"`
}

type Daily struct {
	Series []*float64 `json:"series"`
	Parts  []Named    `json:"parts,omitempty"`
}

// KPI is a definition plus its numbers. Gaps in the data are null.
type KPI struct {
	ID         string     `json:"id"`
	Group      string     `json:"group"`
	Name       string     `json:"name"`
	Long       string     `json:"long"`
	Short      string     `json:"short"`
	Unit       string     `json:"unit"`
	Dec        int        `json:"dec"`
	Kind       string     `json:"kind"`
	Dir        int        `json:"dir"`
	Limit      *float64   `json:"limit"`
	Target     *float64   `json:"target"`
	LimitName  string     `json:"limitName,omitempty"`
	TargetName string     `json:"targetName,omitempty"`
	Desc       string     `json:"desc"`
	Table      string     `json:"table"`
	Hidden     bool       `json:"hidden"`
	Season     bool       `json:"season"`
	PartsMode  string     `json:"partsMode,omitempty"`
	Series     []*float64 `json:"series"`
	Parts      []Named    `json:"parts,omitempty"`
	Daily      *Daily     `json:"daily,omitempty"`
}

type EventAt struct {
	Month int    `json:"month"` // index into Months
	Title string `json:"title"`
	Text  string `json:"text"`
}

type Data struct {
	Title  string    `json:"title"`
	Source string    `json:"source"`
	Months []string  `json:"months"` // YYYY-MM, contiguous
	Days   []string  `json:"days"`   // YYYY-MM-DD, days with daily data
	Groups []Group   `json:"groups"`
	KPIs   []KPI     `json:"kpis"`
	Events []EventAt `json:"events"`
}

// fetch is one query: a table at one grain, optionally split by a dimension.
type fetch struct {
	table, timeCol, split string
	daily                 bool
	cols                  []string
	rows                  map[string]map[string]map[string]float64 // period -> split value -> column -> value
}

func (f *fetch) sql(d adapter.Dialect) string {
	return d.Series(adapter.Series{Table: f.table, Time: f.timeCol, Split: f.split, Daily: f.daily, Values: f.cols})
}

func (f *fetch) add(col string) {
	for _, c := range f.cols {
		if c == col {
			return
		}
	}
	f.cols = append(f.cols, col)
}

// Load reads every figure from the gold layer with one query per table and grain.
func Load(ctx context.Context, ad adapter.Adapter, cat *catalog.Catalog, c *Config) (*Data, error) {
	if len(c.KPIs) == 0 {
		return nil, fmt.Errorf("Keine Kennzahlen definiert.")
	}
	c, err := c.usable(cat)
	if err != nil {
		return nil, err
	}
	fetches := map[string]*fetch{}
	get := func(table, split string, daily bool) *fetch {
		key := fmt.Sprintf("%s|%s|%v", table, split, daily)
		if f, ok := fetches[key]; ok {
			return f
		}
		f := &fetch{table: table, timeCol: cat.Table(table).TimeColumn().Name, split: split, daily: daily}
		fetches[key] = f
		return f
	}
	for _, k := range c.KPIs {
		get(k.Monthly.Table, "", false).add(k.Monthly.Value)
		if k.Daily != nil {
			get(k.Daily.Table, "", true).add(k.Daily.Value)
		}
		if p := k.Parts; p != nil {
			for _, pc := range p.Columns {
				get(k.Monthly.Table, "", false).add(pc.Column)
			}
			if p.Split != "" {
				get(k.Monthly.Table, p.Split, false).add(k.Monthly.Value)
				if k.Daily != nil && cat.Table(k.Daily.Table).Column(p.Split) != nil {
					get(k.Daily.Table, p.Split, true).add(k.Daily.Value)
				}
			}
		}
	}
	dialect := adapter.DialectOf(ad)
	months, days := map[string]bool{}, map[string]bool{}
	for _, f := range fetches {
		rows, err := ad.Query(ctx, f.sql(dialect))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.table, err)
		}
		f.rows = map[string]map[string]map[string]float64{}
		for _, r := range rows {
			p, s := adapter.String(r, "p"), adapter.String(r, "s")
			if f.rows[p] == nil {
				f.rows[p] = map[string]map[string]float64{}
			}
			vals := map[string]float64{}
			for i, col := range f.cols {
				if v, ok := adapter.Float(r, fmt.Sprintf("c%d", i)); ok {
					vals[col] = v
				}
			}
			f.rows[p][s] = vals
			if f.daily {
				days[p] = true
			} else {
				months[p] = true
			}
		}
	}

	d := &Data{Title: c.Title, Source: c.Source, Groups: c.Groups, Months: monthAxis(months), Days: sorted(days)}
	series := func(f *fetch, axis []string, split, col string) []*float64 {
		out := make([]*float64, len(axis))
		for i, p := range axis {
			if v, ok := f.rows[p][split][col]; ok {
				out[i] = &v
			}
		}
		return out
	}
	splitParts := func(f *fetch, axis []string, order []string, col string) []Named {
		names := append([]string{}, order...)
		known := map[string]bool{}
		for _, n := range names {
			known[n] = true
		}
		var extra []string
		for _, bySplit := range f.rows {
			for s := range bySplit {
				if !known[s] {
					known[s] = true
					extra = append(extra, s)
				}
			}
		}
		sort.Strings(extra)
		var out []Named
		for _, n := range append(names, extra...) {
			out = append(out, Named{Name: n, Series: series(f, axis, n, col)})
		}
		return out
	}
	for _, k := range c.KPIs {
		mf := get(k.Monthly.Table, "", false)
		kpi := KPI{ID: k.ID, Group: k.Group, Name: k.Name, Long: k.Long, Short: k.Short, Unit: k.Unit, Dec: k.Dec, Kind: k.Kind, Dir: k.Dir,
			Limit: k.Limit, Target: k.Target, LimitName: k.LimitName, TargetName: k.TargetName, Desc: k.Desc, Table: k.Monthly.Table,
			Hidden: k.Hidden, Season: k.Season, Series: series(mf, d.Months, "", k.Monthly.Value)}
		if kpi.Short == "" {
			kpi.Short = k.Name
		}
		if p := k.Parts; p != nil {
			kpi.PartsMode = p.Mode
			for _, pc := range p.Columns {
				kpi.Parts = append(kpi.Parts, Named{Name: pc.Name, Series: series(mf, d.Months, "", pc.Column)})
			}
			if p.Split != "" {
				kpi.Parts = splitParts(get(k.Monthly.Table, p.Split, false), d.Months, p.Order, k.Monthly.Value)
			}
		}
		if k.Daily != nil {
			df := get(k.Daily.Table, "", true)
			kpi.Daily = &Daily{Series: series(df, d.Days, "", k.Daily.Value)}
			if p := k.Parts; p != nil && p.Split != "" {
				if sf, ok := fetches[fmt.Sprintf("%s|%s|%v", k.Daily.Table, p.Split, true)]; ok {
					kpi.Daily.Parts = splitParts(sf, d.Days, p.Order, k.Daily.Value)
				}
			}
		}
		d.KPIs = append(d.KPIs, kpi)
	}
	index := map[string]int{}
	for i, m := range d.Months {
		index[m] = i
	}
	for _, e := range c.Events {
		if i, ok := index[e.Month]; ok {
			d.Events = append(d.Events, EventAt{Month: i, Title: e.Title, Text: e.Text})
		}
	}
	return d, nil
}

func sorted(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// monthAxis fills the gaps between the first and last month, so index i is
// always the i-th month after the start.
func monthAxis(set map[string]bool) []string {
	ms := sorted(set)
	if len(ms) == 0 {
		return []string{}
	}
	var y, m, ey, em int
	fmt.Sscanf(ms[0], "%d-%d", &y, &m)
	fmt.Sscanf(ms[len(ms)-1], "%d-%d", &ey, &em)
	var out []string
	for y < ey || (y == ey && m <= em) {
		out = append(out, fmt.Sprintf("%04d-%02d", y, m))
		if m++; m > 12 {
			y, m = y+1, 1
		}
	}
	return out
}
