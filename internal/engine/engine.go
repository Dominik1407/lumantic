// Package engine evaluates cards and lets the board order itself.
// Each card is computed exactly from its compiled SQL; the engine then
// decides how loud the card should be and explains why, in plain language.
package engine

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"lumantic/internal/adapter"
	"lumantic/internal/card"
	"lumantic/internal/catalog"
)

const (
	LevelAlert   = "alert"   // rule broken: needs you
	LevelWatch   = "watch"   // just missed, or moving the wrong way
	LevelNotable = "notable" // unusual, often good news
	LevelInfo    = "info"    // a comparison the person asked for
	LevelCalm    = "calm"    // nothing to see

	window    = 14   // weeks loaded per card
	history   = 8    // weeks that define "usual"
	tolerance = 0.03 // a rule missed by less than 3 % is "just missed"
	unusual   = 2.0  // standard deviations that count as unusual…
	material  = 0.05 // …and only if the value is at least 5 % off the usual level
)

type Point struct {
	T string   `json:"t"`
	V float64  `json:"v"`
	C *float64 `json:"c,omitempty"`
}

type Group struct {
	Name string   `json:"name"`
	V    float64  `json:"v"`
	Prev *float64 `json:"prev,omitempty"`
	C    *float64 `json:"c,omitempty"`
}

type Segment struct {
	Text string `json:"text"`
	Em   bool   `json:"em,omitempty"`
}

type Result struct {
	Card      card.Card `json:"card"`
	Level     string    `json:"level"`
	Tone      string    `json:"tone"` // good | bad | neutral
	Label     string    `json:"label"`
	Value     float64   `json:"value"`
	ValueText string    `json:"valueText"`
	Unit      string    `json:"unit"`
	Answer    string    `json:"answer"`
	Delta     string    `json:"delta,omitempty"`
	Why       string    `json:"why,omitempty"`
	RuleText  string    `json:"ruleText,omitempty"`
	Series    []Point   `json:"series"`
	Groups    []Group   `json:"groups,omitempty"`
	Explain   string    `json:"explain"`
	Reason    string    `json:"reason"`
	SQL       string    `json:"sql"`
	Source    string    `json:"source"`
	Score     float64   `json:"score"`
	Error     string    `json:"error,omitempty"`
}

type Board struct {
	AsOf  string    `json:"asOf"`
	Week  int       `json:"week"`
	Stand string    `json:"stand"`
	Brief []Segment `json:"brief"`
	Cards []Result  `json:"cards"`
}

func Evaluate(ctx context.Context, ad adapter.Adapter, cat *catalog.Catalog, cards []card.Card, asOf time.Time) *Board {
	results := make([]Result, len(cards))
	var wg sync.WaitGroup
	for i, c := range cards {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = EvaluateCard(ctx, ad, cat, c, asOf)
		}()
	}
	wg.Wait()
	// Stable: equally calm cards keep the order in which they were added.
	sort.SliceStable(results, func(a, b int) bool { return results[a].Score > results[b].Score })
	_, week := asOf.ISOWeek()
	return &Board{
		AsOf:  asOf.Format("2006-01-02"),
		Week:  week,
		Stand: standText(asOf),
		Brief: brief(results),
		Cards: results,
	}
}

func EvaluateCard(ctx context.Context, ad adapter.Adapter, cat *catalog.Catalog, c card.Card, asOf time.Time) Result {
	s := c.Spec
	r := Result{Card: c, Source: s.Table, Level: LevelCalm, Tone: "neutral", Label: "Ruhig", Series: []Point{}}
	t := cat.Table(s.Table)
	if t == nil || t.Column(s.Measure) == nil {
		r.Error, r.Label = "Diese Daten gibt es im Goldlayer nicht mehr.", "Nicht verfügbar"
		return r
	}
	measure := t.Column(s.Measure)
	unit := measure.Unit

	r.SQL = s.SeriesSQL(cat, asOf, window)
	rows, err := ad.Query(ctx, r.SQL)
	if err != nil {
		r.Error, r.Label = err.Error(), "Nicht verfügbar"
		return r
	}
	for i := len(rows) - 1; i >= 0; i-- {
		p := Point{T: adapter.String(rows[i], "t")}
		p.V, _ = adapter.Float(rows[i], "wert")
		if v, ok := adapter.Float(rows[i], "vergleich"); ok {
			p.C = &v
		}
		r.Series = append(r.Series, p)
	}
	if len(r.Series) == 0 {
		r.Error, r.Label = "Für diese Woche gibt es noch keine Daten.", "Keine Daten"
		return r
	}

	last := r.Series[len(r.Series)-1]
	cur := last.V
	r.Value = cur
	r.ValueText, r.Unit = FormatValue(cur, unit)

	past := make([]float64, 0, history)
	for _, p := range r.Series[max(0, len(r.Series)-1-history) : len(r.Series)-1] {
		past = append(past, p.V)
	}
	mean, sd := stats(past)
	// z stays 0 unless the move is both statistically unusual and material:
	// a quiet series wobbling by 0.2 minutes is not news.
	z := 0.0
	if sd > 1e-9 && mean != 0 && math.Abs(cur-mean)/math.Abs(mean) >= material {
		z = (cur - mean) / sd
	}

	// What does "good" mean for this card, and how far are we from it?
	goodDir := 0
	var thr, margin *float64
	if s.Good != nil {
		goodDir = -1
		if s.Good.Op == ">=" {
			goodDir = 1
		}
		if s.Good.Vs {
			thr = last.C
		} else {
			thr = s.Good.Value
		}
		if thr != nil && *thr != 0 {
			m := (cur - *thr) / math.Abs(*thr) * float64(goodDir)
			margin = &m
		}
		r.RuleText = ruleText(s, unit)
	}

	byMovement := false
	switch {
	case margin != nil && *margin < -tolerance:
		r.Level, r.Tone, r.Label = LevelAlert, "bad", "Braucht Aufmerksamkeit"
		r.Score = 1000 + math.Abs(*margin)*100
		r.Reason = fmt.Sprintf("Die Regel «%s» ist um %s verfehlt, mehr als die Toleranz von 3 %%.", strings.TrimPrefix(r.RuleText, "Gut ist, wenn "), pct(*margin))
	case margin != nil && *margin < 0:
		r.Level, r.Tone, r.Label = LevelWatch, "bad", "Knapp verfehlt"
		r.Score = 700 + math.Abs(*margin)*100
		r.Reason = fmt.Sprintf("Die Regel ist um %s verfehlt, also innerhalb der Toleranz von 3 %%.", pct(*margin))
	case math.Abs(z) >= unusual && goodDir != 0 && sign(z) != goodDir:
		r.Level, r.Tone, r.Label, byMovement = LevelWatch, "bad", "Auffällige Bewegung", true
		r.Score = 600 + math.Abs(z)
		r.Reason = movementReason(cur, mean, unit)
	case math.Abs(z) >= unusual:
		r.Level, r.Label, byMovement = LevelNotable, "Ungewöhnlich", true
		if goodDir != 0 {
			r.Tone, r.Label = "good", "Gute Nachricht"
		}
		r.Score = 500 + math.Abs(z)
		r.Reason = movementReason(cur, mean, unit)
	case s.Display == "bars":
		r.Level, r.Label, r.Score = LevelInfo, "Überblick", 300
		r.Reason = "Ein Vergleich, den du angefragt hast. Er wird nicht bewertet."
	default:
		r.Score = 100
		r.Reason = "Der Wert liegt im üblichen Rahmen der letzten 8 Wochen"
		if s.Good != nil {
			r.Reason += " und erfüllt die Regel"
		}
		r.Reason += "."
	}

	// Split by a dimension: for bar cards always, otherwise to find the driver.
	if by := s.DriverColumn(t); by != "" && (s.Display == "bars" || r.Level != LevelCalm) {
		gsql := s.GroupsSQL(cat, by, asOf, asOf.AddDate(0, 0, -7))
		if grows, err := ad.Query(ctx, gsql); err == nil {
			groups := toGroups(grows)
			if s.Display == "bars" {
				r.Groups = groups
				r.SQL += "\n\n-- Aufteilung\n" + gsql
			} else if why := driver(s, groups, unit, goodDir, by); why != "" {
				r.Why = why
				r.SQL += "\n\n-- Treiber\n" + gsql
			}
		}
	}

	var prev *float64
	if len(r.Series) > 1 {
		prev = &r.Series[len(r.Series)-2].V
	}
	r.Delta = delta(cur, prev, unit)
	r.Answer = answer(s, r, cur, thr, margin, z, byMovement, unit)
	r.Explain = explain(s, t, measure)
	return r
}

func stats(xs []float64) (mean, sd float64) {
	if len(xs) == 0 {
		return 0, 0
	}
	for _, x := range xs {
		mean += x
	}
	mean /= float64(len(xs))
	for _, x := range xs {
		sd += (x - mean) * (x - mean)
	}
	return mean, math.Sqrt(sd / float64(len(xs)))
}

func sign(v float64) int {
	if v < 0 {
		return -1
	}
	return 1
}

func toGroups(rows []adapter.Row) []Group {
	groups := make([]Group, 0, len(rows))
	for _, row := range rows {
		g := Group{Name: adapter.String(row, "gruppe")}
		g.V, _ = adapter.Float(row, "wert")
		if v, ok := adapter.Float(row, "vorher"); ok {
			g.Prev = &v
		}
		if v, ok := adapter.Float(row, "vergleich"); ok {
			g.C = &v
		}
		groups = append(groups, g)
	}
	return groups
}

// driver names the group that explains a deviation, but only when one group
// clearly stands out: if every branch moved alike, there is no single reason.
func driver(s card.Spec, groups []Group, unit string, goodDir int, by string) string {
	best, bestScore, second := -1, 0.0, 0.0
	vsRule := s.Good != nil && s.Good.Vs
	for i, g := range groups {
		var score float64
		switch {
		case vsRule && g.C != nil:
			score = (g.V - *g.C) * float64(-goodDir)
		case g.Prev != nil:
			score = g.V - *g.Prev
			if goodDir == 0 {
				score = math.Abs(score)
			} else {
				score *= float64(-goodDir)
			}
		}
		switch {
		case score > bestScore:
			second = bestScore
			best, bestScore = i, score
		case score > second:
			second = score
		}
	}
	if best < 0 || bestScore < 1.5*second {
		return ""
	}
	g := groups[best]
	if vsRule && g.C != nil {
		diff := g.V - *g.C
		word := "über"
		if diff < 0 {
			word = "unter"
		}
		return fmt.Sprintf("Grund: %s, %s %s %s", g.Name, formatDelta(diff, unit), word, vsName(s.Vs))
	}
	diff := g.V - *g.Prev
	return fmt.Sprintf("Grund: %s %s, %s%s gegenüber Vorwoche", capitalize(by), g.Name, signed(diff), formatDelta(diff, unit))
}

func delta(cur float64, prev *float64, unit string) string {
	if prev == nil {
		return ""
	}
	diff := cur - *prev
	if scaleUnit(unit) {
		if math.Abs(diff) < 0.05 {
			return "Wie in der Vorwoche"
		}
		return arrow(diff) + formatDelta(diff, unit) + " gegenüber Vorwoche"
	}
	if *prev == 0 {
		return ""
	}
	d := diff / math.Abs(*prev)
	if math.Abs(d) < 0.005 {
		return "Wie in der Vorwoche"
	}
	return arrow(d) + pct(d) + " gegenüber Vorwoche"
}

func ruleText(s card.Spec, unit string) string {
	word := "höchstens"
	if s.Good.Op == ">=" {
		word = "mindestens"
	}
	target := vsName(s.Vs)
	if !s.Good.Vs && s.Good.Value != nil {
		target = FormatPlain(*s.Good.Value, unit)
	}
	return "Gut ist, wenn " + word + " " + target
}

func answer(s card.Spec, r Result, cur float64, thr, margin *float64, z float64, byMovement bool, unit string) string {
	if s.Display == "bars" && len(r.Groups) > 0 {
		return fmt.Sprintf("%s liegt vorne, mit %s", r.Groups[0].Name, FormatPlain(r.Groups[0].V, unit))
	}
	if s.Good != nil && s.Good.Vs && thr != nil && *thr != 0 {
		d := cur / *thr - 1
		name := vsName(s.Vs)
		switch {
		case math.Abs(d) < 0.0005:
			return "Ja, genau im " + name
		case s.Good.Op == "<=" && d > 0:
			return "Nein, " + pct(d) + " über " + name
		case s.Good.Op == "<=":
			return "Ja, " + pct(d) + " unter " + name
		case d >= 0:
			return "Ja, " + pct(d) + " über " + name
		default:
			return "Nein, " + pct(d) + " unter " + name
		}
	}
	if byMovement {
		return movement(r.Series, z)
	}
	if s.Good != nil && thr != nil && margin != nil {
		limit := FormatPlain(*thr, unit)
		switch {
		case s.Good.Op == "<=" && *margin < 0:
			return pct(*margin) + " über der Grenze von " + limit
		case s.Good.Op == ">=" && *margin < 0:
			return pct(*margin) + " unter dem Ziel von " + limit
		case *margin < 0.05 && s.Good.Op == "<=":
			return "Knapp unter der Grenze von " + limit
		case *margin < 0.05:
			return "Knapp über dem Ziel von " + limit
		}
		return "Im grünen Bereich"
	}
	return "Im üblichen Rahmen"
}

func movement(series []Point, z float64) string {
	cur := series[len(series)-1].V
	hi, lo := true, true
	for _, p := range series[:len(series)-1] {
		hi = hi && cur > p.V
		lo = lo && cur < p.V
	}
	n := len(series)
	switch {
	case hi && n > 4:
		return fmt.Sprintf("Höchster Wert der letzten %d Wochen", n)
	case lo && n > 4:
		return fmt.Sprintf("Tiefster Wert der letzten %d Wochen", n)
	case z > 0:
		return "Deutlich höher als üblich"
	}
	return "Deutlich tiefer als üblich"
}

func movementReason(cur, mean float64, unit string) string {
	return fmt.Sprintf("Der Wert weicht deutlich vom Durchschnitt der letzten 8 Wochen ab: %s statt üblich %s.",
		FormatPlain(cur, unit), FormatPlain(mean, unit))
}

func explain(s card.Spec, t *catalog.Table, measure *catalog.Column) string {
	var b strings.Builder
	what := "die Summe"
	if s.Agg == "avg" {
		what = "den Durchschnitt"
	}
	desc := measure.Desc
	if desc == "" {
		desc = measure.Name
	}
	fmt.Fprintf(&b, "Pro Woche bildet Lumantic %s von «%s»", what, desc)
	if cols := s.FilterColumns(); len(cols) > 0 {
		parts := make([]string, len(cols))
		for i, col := range cols {
			parts[i] = fmt.Sprintf("%s «%s»", capitalize(col), s.Filter[col])
		}
		b.WriteString(", nur " + joinGerman(parts))
	}
	fmt.Fprintf(&b, ". Quelle: %s.", t.Desc)
	if s.Vs != "" {
		if c := t.Column(s.Vs); c != nil && c.Desc != "" {
			fmt.Fprintf(&b, " Verglichen wird mit «%s».", c.Desc)
		}
	}
	return b.String()
}

func brief(results []Result) []Segment {
	var alerts, watches, goods []string
	for _, r := range results {
		switch {
		case r.Level == LevelAlert:
			alerts = append(alerts, r.Card.Spec.Short)
		case r.Level == LevelWatch:
			watches = append(watches, r.Card.Spec.Short)
		case r.Level == LevelNotable && r.Tone == "good":
			goods = append(goods, r.Card.Spec.Short)
		}
	}
	var segs []Segment
	add := func(text string, em bool) { segs = append(segs, Segment{Text: text, Em: em}) }
	switch {
	case len(alerts) == 0 && len(watches) == 0:
		add("Alles ruhig. ", false)
		if len(goods) == 0 {
			add("Nichts braucht dich heute.", false)
		}
	case len(alerts) == 0:
		add("Fast alles ruhig. Behalte ", false)
		add(joinGerman(watches), true)
		add(" im Auge.", false)
	case len(alerts) == 1 && len(watches) == 0:
		add("Ruhiger Tag. Nur eine Sache braucht dich: ", false)
		add(alerts[0], true)
		add(".", false)
	case len(alerts) == 1:
		add("Eine Sache braucht dich: ", false)
		add(alerts[0], true)
		add(". Im Auge behalten: "+joinGerman(watches)+".", false)
	default:
		add(numberWord(len(alerts))+" Dinge brauchen dich: ", false)
		add(joinGerman(alerts), true)
		add(".", false)
	}
	if len(goods) > 0 {
		add(" Gute Nachricht: "+joinGerman(goods)+".", false)
	}
	return segs
}
