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

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/catalog"
)

//go:embed default.json
var defaultJSON []byte

type Source struct {
	Table string `json:"table"`
	Value string `json:"value"`
	Time  string `json:"time,omitempty"` // the date column; empty = the table's first one
}

type PartColumn struct {
	Name   string `json:"name"`
	Column string `json:"column"`
}

// Parts break a figure down, either into columns of the same table or by the
// values of a dimension (split). Mode tells the UI how the parts combine.
type Parts struct {
	Mode    string       `json:"mode"`           // "sum", "ratio" (numerator ÷ denominator) or "funnel"
	Kind    string       `json:"kind,omitempty"` // ratio: how both add up over a quarter, "stock" (at its end) or "flow" (summed)
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
	Unit       string   `json:"unit"` // one of Units; amounts of money are in Mio. CHF
	Dec        int      `json:"dec"`
	Kind       string   `json:"kind"` // "stock" (balance at month end), "flow" (sum over the month), "avg" (average of the months) or "ratio" (from its parts)
	Dir        int      `json:"dir"`  // 1 higher is better, -1 lower is better, 0 neutral
	Limit      *float64 `json:"limit,omitempty"`
	Target     *float64 `json:"target,omitempty"`
	LimitName  string   `json:"limitName,omitempty"`
	TargetName string   `json:"targetName,omitempty"`
	Desc       string   `json:"desc"`
	Hidden     bool     `json:"hidden,omitempty"`
	Season     bool     `json:"season,omitempty"`
	Access     []string `json:"access,omitempty"`  // groups that see this figure; empty = everyone who sees the Kosmos
	Formula    string   `json:"formula,omitempty"` // how it is computed, in words
	Owner      string   `json:"owner,omitempty"`   // who answers for it
	Bounds     []Bound  `json:"bounds,omitempty"`  // targets and limits that hold for a time
	// A flow's target: "monat" (target holds per month, the default) or "jahr"
	// (an annual budget). How a year spreads over months and days: Phasings.
	TargetPer string    `json:"targetPer,omitempty"`
	Phasing   string    `json:"phasing,omitempty"`
	Profile   []float64 `json:"profile,omitempty"` // twelve weights, for phasing "profil"
	Monthly   Source    `json:"monthly"`
	Daily     *Source   `json:"daily,omitempty"`
	Parts     *Parts    `json:"parts,omitempty"`
	// En holds the English words of the figure: name, long, short, desc,
	// targetName and limitName. What is missing reads in the language given.
	En Words `json:"en,omitempty"`
}

// Words are the English texts of a definition, by field. Lumantic translates
// its own texts; what a team defines it writes here in English, if it wants.
type Words map[string]string

// Units a figure can have. Money is kept in Mio. CHF ("Mrd" only changes how it
// reads, "Tsd" is thousands of CHF); the others are pieces, days, hours and
// plain numbers.
var Units = map[string]bool{"%": true, "Mio": true, "Mrd": true, "Tsd": true, "Stk": true, "Tage": true, "h": true, "Zahl": true}

// Kinds say how a figure adds up to a quarter or a year: a balance counts at
// the period's end, a flow is summed, an average is the mean of its months, a
// ratio divides its numerator by its denominator, each added up by its own kind.
// Percentages are never averaged when their parts are known.
var Kinds = map[string]bool{"stock": true, "flow": true, "avg": true, "ratio": true}

type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	En   Words  `json:"en,omitempty"` // name
}

type Event struct {
	Month string `json:"month"` // YYYY-MM
	Title string `json:"title"`
	Text  string `json:"text"`
	En    Words  `json:"en,omitempty"` // title, text
}

type Config struct {
	Title  string  `json:"title"`
	Source string  `json:"source"`
	En     Words   `json:"en,omitempty"` // title, source
	Groups []Group `json:"groups"`
	KPIs   []Def   `json:"kpis"`
	Events []Event `json:"events"`
	// The catalog: words of the business, and what Lumantic adds to figures of
	// a company catalog in the source (internal/katalog).
	Terms []Term           `json:"terms,omitempty"`
	Extra map[string]Extra `json:"extra,omitempty"`
	// Phasing is how annual targets spread when a figure says nothing; empty =
	// the standard, "monate".
	Phasing string `json:"phasing,omitempty"`
	// Origins says per figure and field where a value came from: "quelle",
	// "lumantic" or "vermutet". Set when a company catalog is merged in.
	Origins map[string]map[string]string `json:"-"`
}

// Bound is a target or a limit that holds for a time, such as the target of
// one year.
type Bound struct {
	Kind  string  `json:"kind"` // "ziel" or "grenze"
	Value float64 `json:"value"`
	Name  string  `json:"name,omitempty"`
	From  string  `json:"from,omitempty"`  // first month, YYYY-MM or YYYY-MM-DD; empty = from the start
	Until string  `json:"until,omitempty"` // last month, inclusive; empty = open
	// Per says what time a flow's value covers: "jahr" (the default for a
	// bound: a budget) or "monat". Balances, averages and ratios hold as they are.
	Per    string `json:"per,omitempty"`
	Origin string `json:"origin,omitempty"` // "quelle" or "lumantic", set by the merge
}

// Term is a word of the business and what it means, so people and Lumina use
// the same words.
type Term struct {
	Term       string   `json:"term"`
	Definition string   `json:"definition"`
	Synonyms   []string `json:"synonyms,omitempty"`
	KPI        string   `json:"kpi,omitempty"`    // the figure it names, if any
	Origin     string   `json:"origin,omitempty"` // "quelle" or "lumantic", set by the merge
	En         Words    `json:"en,omitempty"`     // term, definition
}

// Extra is what Lumantic adds to a figure of the company catalog: only what the
// catalog leaves open. Empty fields add nothing.
type Extra struct {
	Desc       string   `json:"desc,omitempty"`
	Formula    string   `json:"formula,omitempty"`
	Owner      string   `json:"owner,omitempty"`
	Short      string   `json:"short,omitempty"`
	Unit       string   `json:"unit,omitempty"`
	Kind       string   `json:"kind,omitempty"`
	Dir        *int     `json:"dir,omitempty"`
	Dec        *int     `json:"dec,omitempty"`
	Target     *float64 `json:"target,omitempty"`
	Limit      *float64 `json:"limit,omitempty"`
	TargetName string   `json:"targetName,omitempty"`
	LimitName  string   `json:"limitName,omitempty"`
	Access     []string `json:"access,omitempty"`
	Hidden     bool     `json:"hidden,omitempty"`
	TargetPer  string   `json:"targetPer,omitempty"`
	Phasing    string   `json:"phasing,omitempty"`
	En         Words    `json:"en,omitempty"` // desc, formula, targetName, limitName
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
		case !Units[k.Unit]:
			return fmt.Errorf("Kennzahl %s: Einheit muss %%, Mio, Mrd, Tsd, Stk, Tage, h oder Zahl sein", k.ID)
		case !Kinds[k.Kind]:
			return fmt.Errorf("Kennzahl %s: kind muss stock, flow, avg oder ratio sein", k.ID)
		case k.Kind == "ratio" && (k.Parts == nil || k.Parts.Mode != "ratio"):
			return fmt.Errorf("Kennzahl %s: ein Verhältnis (ratio) braucht parts mit mode ratio, Zähler und Nenner", k.ID)
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
			if p.Kind != "" && p.Kind != "stock" && p.Kind != "flow" {
				return fmt.Errorf("Kennzahl %s: parts.kind muss stock oder flow sein", k.ID)
			}
		}
		if err := checkPhasing(k.ID, k.TargetPer, k.Phasing, k.Profile); err != nil {
			return err
		}
		seen[k.ID] = true
	}
	if c.Phasing != "" && (c.Phasing == "profil" || !Phasings[c.Phasing]) {
		return fmt.Errorf("phasing muss monate, arbeitstage oder kalendertage sein")
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
	if k.Monthly.Time != "" {
		need(k.Monthly.Table, k.Monthly.Time)
	}
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
	PartsKind  string     `json:"partsKind,omitempty"` // ratio: "stock" or "flow"
	Series     []*float64 `json:"series"`
	Parts      []Named    `json:"parts,omitempty"`
	Daily      *Daily     `json:"daily,omitempty"`  // on Data.Days
	Weekly     *Daily     `json:"weekly,omitempty"` // on Data.Weeks, added up by kind
	// TargetPer is "jahr" when the target that holds now is an annual budget;
	// DayRule "kalendertage" when a flow's target counts every day, not only
	// Monday to Friday.
	TargetPer string `json:"targetPer,omitempty"`
	DayRule   string `json:"dayRule,omitempty"`
	// Targets and limits per month, where they change over time (Bounds);
	// Target and Limit then hold the values of the last month.
	Targets []*float64 `json:"targets,omitempty"`
	Limits  []*float64 `json:"limits,omitempty"`
	En      Words      `json:"en,omitempty"`
}

type EventAt struct {
	Month int    `json:"month"` // index into Months
	Title string `json:"title"`
	Text  string `json:"text"`
	En    Words  `json:"en,omitempty"`
}

type Data struct {
	Title  string    `json:"title"`
	Source string    `json:"source"`
	En     Words     `json:"en,omitempty"`
	Months []string  `json:"months"` // YYYY-MM, contiguous
	Days   []string  `json:"days"`   // YYYY-MM-DD, days with daily data, the last DaysShown days
	Weeks  []Week    `json:"weeks"`  // ISO weeks of the daily data, the last WeeksShown
	Groups []Group   `json:"groups"`
	KPIs   []KPI     `json:"kpis"`
	Events []EventAt `json:"events"`
	Grain  string    `json:"grain,omitempty"` // the Kosmos' standard raster; set by the server
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
	// A figure may name its date column; otherwise the table's first one counts.
	timeCols := map[string]string{}
	for _, k := range c.KPIs {
		if k.Monthly.Time != "" {
			timeCols[k.Monthly.Table] = k.Monthly.Time
		}
	}
	get := func(table, split string, daily bool) *fetch {
		key := fmt.Sprintf("%s|%s|%v", table, split, daily)
		if f, ok := fetches[key]; ok {
			return f
		}
		timeCol := timeCols[table]
		if timeCol == "" {
			timeCol = cat.Table(table).TimeColumn().Name
		}
		f := &fetch{table: table, timeCol: timeCol, split: split, daily: daily}
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
				if dailyHas(k, cat, pc.Column) {
					get(k.Daily.Table, "", true).add(pc.Column)
				}
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

	d := &Data{Title: c.Title, Source: c.Source, En: c.En, Groups: c.Groups, Months: monthAxis(months), Days: sorted(days)}
	weeks := weeksOf(d.Days, WeeksShown)
	d.Weeks = weeks
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
			Limit: k.Limit, Target: k.Target, LimitName: k.LimitName, TargetName: k.TargetName, Desc: k.Desc, En: k.En, Table: k.Monthly.Table,
			Hidden: k.Hidden, Season: k.Season, Series: series(mf, d.Months, "", k.Monthly.Value)}
		phasing := phasingOf(k, c)
		if phasing == "kalendertage" {
			kpi.DayRule = phasing
		}
		// A flow's annual target or budget becomes one target per month, by its phasing.
		conv := func(v float64, per, month string) float64 { return v }
		if k.Kind == "flow" {
			conv = func(v float64, per, month string) float64 { return toMonth(v, per, month, phasing, k.Profile) }
		}
		if len(k.Bounds) > 0 || (k.Kind == "flow" && k.TargetPer == "jahr" && k.Target != nil) {
			var tn, ln string
			kpi.Targets, kpi.Target, tn, kpi.TargetPer = boundSeries(k.Bounds, "ziel", k.Target, k.TargetPer, d.Months, conv)
			kpi.Limits, kpi.Limit, ln, _ = boundSeries(k.Bounds, "grenze", k.Limit, "monat", d.Months, conv)
			if k.Kind != "flow" {
				kpi.TargetPer = ""
			}
			// A bound's name ("Budget 2026", "Mindestwert") speaks where the figure gives none.
			if kpi.TargetName == "" {
				kpi.TargetName = tn
			}
			if kpi.LimitName == "" {
				kpi.LimitName = ln
			}
		}
		if kpi.Short == "" {
			kpi.Short = k.Name
		}
		if p := k.Parts; p != nil {
			kpi.PartsMode = p.Mode
			if p.Mode == "ratio" {
				kpi.PartsKind = p.Kind
			}
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
			} else if p != nil && len(p.Columns) > 0 && dailyHas(k, cat, columnsOf(p)...) {
				for _, pc := range p.Columns {
					kpi.Daily.Parts = append(kpi.Daily.Parts, Named{Name: pc.Name, Series: series(df, d.Days, "", pc.Column)})
				}
			}
			kpi.Weekly = weeklyOf(kpi, d.Days, weeks)
		}
		d.KPIs = append(d.KPIs, kpi)
	}
	// The browser gets the recent days only; the weeks were made from all of them.
	if cut := recent(d.Days, DaysShown); cut > 0 {
		d.Days = d.Days[cut:]
		for i := range d.KPIs {
			if dl := d.KPIs[i].Daily; dl != nil {
				dl.Series = dl.Series[cut:]
				for j := range dl.Parts {
					dl.Parts[j].Series = dl.Parts[j].Series[cut:]
				}
			}
		}
	}
	index := map[string]int{}
	for i, m := range d.Months {
		index[m] = i
	}
	for _, e := range c.Events {
		if i, ok := index[e.Month]; ok {
			d.Events = append(d.Events, EventAt{Month: i, Title: e.Title, Text: e.Text, En: e.En})
		}
	}
	return d, nil
}

// boundSeries resolves the bounds of one kind month by month: base (a target
// that always holds) where none applies, the later bound where two do. conv
// turns a value into the month's (an annual budget into its share). It
// returns nil when nothing changes over time, then the value of the last
// month, the name of the bound that holds then and what time it covers.
func boundSeries(bounds []Bound, kind string, base *float64, basePer string, months []string, conv func(v float64, per, month string) float64) ([]*float64, *float64, string, string) {
	any := false
	for _, b := range bounds {
		any = any || b.Kind == kind
	}
	if (!any && (basePer != "jahr" || base == nil)) || len(months) == 0 {
		return nil, base, "", ""
	}
	ym := func(s string) string {
		if len(s) > 7 {
			return s[:7]
		}
		return s
	}
	out := make([]*float64, len(months))
	name, per := "", basePer
	for i, m := range months {
		out[i], per = nil, basePer
		if base != nil {
			v := conv(*base, basePer, m)
			out[i] = &v
		}
		for _, b := range bounds {
			if b.Kind == kind && (b.From == "" || m >= ym(b.From)) && (b.Until == "" || m <= ym(b.Until)) {
				// A target without a period is a budget for its time; a limit holds per month.
				p := b.Per
				if p == "" && kind == "ziel" {
					p = "jahr"
				} else if p == "" {
					p = "monat"
				}
				v := conv(b.Value, p, m)
				out[i], per = &v, p
				if i == len(months)-1 {
					name = b.Name
				}
			}
		}
	}
	return out, out[len(out)-1], name, per
}

func columnsOf(p *Parts) []string {
	out := make([]string, len(p.Columns))
	for i, pc := range p.Columns {
		out[i] = pc.Column
	}
	return out
}

// dailyHas says whether the figure's daily table has all these columns.
func dailyHas(k Def, cat *catalog.Catalog, cols ...string) bool {
	if k.Daily == nil {
		return false
	}
	t := cat.Table(k.Daily.Table)
	for _, c := range cols {
		if t == nil || t.Column(c) == nil {
			return false
		}
	}
	return t != nil
}

// weeklyOf adds a figure's days up to weeks by its kind. A ratio divides its
// summed or closing parts when the daily table has them, and averages its days
// otherwise.
func weeklyOf(k KPI, days []string, weeks []Week) *Daily {
	if k.Daily == nil || len(weeks) == 0 {
		return nil
	}
	partKind := k.Kind
	if k.PartsMode == "ratio" {
		partKind = k.PartsKind
		if partKind == "" {
			partKind = "stock"
			if k.Kind == "flow" {
				partKind = "flow"
			}
		}
	}
	out := &Daily{Series: weekly(days, weeks, k.Daily.Series, k.Kind)}
	if k.Kind == "ratio" && k.PartsMode == "ratio" && len(k.Daily.Parts) == 2 {
		out.Series = ratioOf(days, weeks, k.Daily.Series, k.Daily.Parts[0].Series, k.Daily.Parts[1].Series, partKind)
	}
	for _, p := range k.Daily.Parts {
		out.Parts = append(out.Parts, Named{Name: p.Name, Series: weekly(days, weeks, p.Series, partKind)})
	}
	return out
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
