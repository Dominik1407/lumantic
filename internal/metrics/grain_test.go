package metrics

import (
	"context"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/catalog"
)

func TestISOWeeks(t *testing.T) {
	// The 29th of December 2025 is a Monday and already in week 1 of 2026.
	if key, monday := weekOf(dayOf("2025-12-31")); key != "2026-W01" || monday.Format(time.DateOnly) != "2025-12-29" {
		t.Fatalf("%s %s", key, monday)
	}
	ws := weeksOf([]string{"2025-12-24", "2026-01-07"}, 104)
	if len(ws) != 3 || ws[0].Key != "2025-W52" || ws[1].Key != "2026-W01" || ws[2].To != "2026-01-11" {
		t.Fatalf("%+v", ws)
	}
	if ws := weeksOf([]string{"2020-01-01", "2026-01-07"}, 104); len(ws) != 104 || ws[103].Key != "2026-W02" {
		t.Fatalf("only the last two years: %d %+v", len(ws), ws[len(ws)-1])
	}
	days := []string{"2026-01-02", "2026-06-30", "2026-07-01", "2026-09-28"}
	if recent(days, 90) != 2 {
		t.Fatalf("recent: %d", recent(days, 90))
	}
}

func TestSumUpByKind(t *testing.T) {
	v := func(x float64) *float64 { return &x }
	vals := []*float64{v(2), nil, v(4), v(9)}
	for kind, want := range map[string]float64{"stock": 9, "flow": 15, "avg": 5} {
		if got := sumUp(kind, vals); got == nil || *got != want {
			t.Errorf("%s: %v", kind, got)
		}
	}
	if sumUp("flow", []*float64{nil, nil}) != nil {
		t.Error("a week without rows is empty, not zero")
	}
}

// days answers a monthly and a daily table: business days from Wednesday, the
// 1st of April 2026, to Friday, the 16th of October 2026.
type days struct{}

func (days) Name() string                                       { return "fake" }
func (days) Dialect() string                                    { return "duckdb" }
func (days) Describe(context.Context) (*catalog.Catalog, error) { return nil, nil }
func (days) Query(_ context.Context, sql string) ([]adapter.Row, error) {
	var rows []adapter.Row
	if strings.Contains(sql, `"g"."tag"`) {
		i := 0
		for d := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC); !d.After(time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)); d = d.AddDate(0, 0, 1) {
			if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
				continue
			}
			a := float64(i%2 + 1)
			rows = append(rows, adapter.Row{"p": d.Format(time.DateOnly), "c0": a / 4 * 100, "c1": a, "c2": 4.0})
			i++
		}
		return rows, nil
	}
	for m := 4; m <= 10; m++ {
		rows = append(rows, adapter.Row{"p": time.Date(2026, time.Month(m), 1, 0, 0, 0, 0, time.UTC).Format("2006-01"), "c0": 30.0, "c1": 30.0, "c2": 120.0})
	}
	return rows, nil
}

func dayCatalog() *catalog.Catalog {
	cols := func(time string) []catalog.Column {
		return []catalog.Column{{Name: time, Role: catalog.RoleTime}, {Name: "wert"}, {Name: "a"}, {Name: "b"}}
	}
	return &catalog.Catalog{Tables: []catalog.Table{{Name: "g.monat", Columns: cols("monat")}, {Name: "g.tag", Columns: cols("tag")}}}
}

func TestWeeksFromDays(t *testing.T) {
	c := &Config{Groups: []Group{{ID: "a"}}, KPIs: []Def{
		{ID: "x", Group: "a", Unit: "Stk", Kind: "flow", Monthly: Source{Table: "g.monat", Value: "wert"}, Daily: &Source{Table: "g.tag", Value: "wert"}},
		{ID: "q", Group: "a", Unit: "%", Kind: "ratio", Monthly: Source{Table: "g.monat", Value: "wert"}, Daily: &Source{Table: "g.tag", Value: "wert"},
			Parts: &Parts{Mode: "ratio", Kind: "flow", Columns: []PartColumn{{Name: "A", Column: "a"}, {Name: "B", Column: "b"}}}},
	}}
	d, err := Load(context.Background(), days{}, dayCatalog(), c)
	if err != nil {
		t.Fatal(err)
	}
	// Weeks from the first day's on, the days of the last 90 only.
	if d.Weeks[0].Key != "2026-W14" || d.Weeks[len(d.Weeks)-1].Key != "2026-W42" || d.Days[0] < "2026-07-19" || d.Days[len(d.Days)-1] != "2026-10-16" {
		t.Fatalf("weeks %s to %s, days %s to %s", d.Weeks[0].Key, d.Weeks[len(d.Weeks)-1].Key, d.Days[0], d.Days[len(d.Days)-1])
	}
	x, q := d.KPIs[0], d.KPIs[1]
	if len(x.Daily.Series) != len(d.Days) || len(x.Weekly.Series) != len(d.Weeks) {
		t.Fatalf("lengths %d %d", len(x.Daily.Series), len(x.Weekly.Series))
	}
	// A flow sums its days: the first week has three of them (Wednesday to Friday), the next five.
	if *x.Weekly.Series[0] != 25+50+25 || *x.Weekly.Series[1] != 50+25+50+25+50 {
		t.Fatalf("flow weeks %v %v", *x.Weekly.Series[0], *x.Weekly.Series[1])
	}
	// A ratio of flows divides the summed parts, in the scale of its data: (2+1+2+1+2) ÷ 20 × 100.
	if len(q.Daily.Parts) != 2 || math.Abs(*q.Weekly.Series[1]-40) > 1e-9 || *q.Weekly.Parts[0].Series[1] != 8 {
		t.Fatalf("ratio week %v parts %d", *q.Weekly.Series[1], len(q.Daily.Parts))
	}
}

// An annual target spreads by the standard of controlling: a twelfth per month;
// or by working days, calendar days or a profile.
func TestAnnualTargets(t *testing.T) {
	if s := monthShare(2026, time.February, "monate", nil); math.Abs(s-1.0/12) > 1e-12 {
		t.Fatal(s)
	}
	if s := monthShare(2026, time.February, "arbeitstage", nil); math.Abs(s-20.0/261) > 1e-12 {
		t.Fatalf("Feb 2026 has 20 of 261 working days: %v", s)
	}
	profile := []float64{1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2}
	if s := monthShare(2026, time.March, "profil", profile); math.Abs(s-2.0/16) > 1e-12 {
		t.Fatal(s)
	}
	year, budget := 1200.0, 2400.0
	c := &Config{Groups: []Group{{ID: "a"}}, KPIs: []Def{
		{ID: "x", Group: "a", Unit: "Mio", Kind: "flow", Target: &year, TargetPer: "jahr", Monthly: Source{Table: "g.monat", Value: "wert"}},
		{ID: "y", Group: "a", Unit: "Mio", Kind: "flow", Phasing: "kalendertage", Monthly: Source{Table: "g.monat", Value: "wert"},
			Bounds: []Bound{{Kind: "ziel", Value: budget, Name: "Budget 2026", From: "2026-01"}, {Kind: "grenze", Value: 5}}},
		{ID: "z", Group: "a", Unit: "%", Kind: "stock", Monthly: Source{Table: "g.monat", Value: "wert"}, Bounds: []Bound{{Kind: "ziel", Value: 80}}},
	}}
	d, err := Load(context.Background(), days{}, dayCatalog(), c)
	if err != nil {
		t.Fatal(err)
	}
	x, y, z := d.KPIs[0], d.KPIs[1], d.KPIs[2]
	if *x.Targets[0] != 100 || *x.Target != 100 || x.TargetPer != "jahr" {
		t.Fatalf("an annual target of 1200 is 100 a month: %v %v %q", *x.Targets[0], *x.Target, x.TargetPer)
	}
	// A budget is annual unless it says otherwise; October has 31 of 365 days. A limit holds per month.
	if math.Abs(*y.Target-budget*31/365) > 1e-9 || y.TargetName != "Budget 2026" || y.DayRule != "kalendertage" || *y.Limit != 5 {
		t.Fatalf("budget: %v %q %q limit %v", *y.Target, y.TargetName, y.DayRule, *y.Limit)
	}
	if *z.Target != 80 || z.TargetPer != "" {
		t.Fatalf("a balance's target holds as it is: %v %q", *z.Target, z.TargetPer)
	}
	for name, k := range map[string]Def{
		"a strange period":       {TargetPer: "woche"},
		"a strange phasing":      {Phasing: "quartale"},
		"a profile of eleven":    {Phasing: "profil", Profile: profile[:11]},
		"a profile of nothing":   {Phasing: "profil", Profile: make([]float64, 12)},
		"a profile with a minus": {Profile: []float64{-1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1}},
	} {
		if checkPhasing("x", k.TargetPer, k.Phasing, k.Profile) == nil {
			t.Errorf("%s must be refused", name)
		}
	}
}
