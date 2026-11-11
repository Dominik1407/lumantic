// Package card defines the building block of Lumantic: a question with a
// fixed, checkable computation behind it. Lumina writes a Spec, never SQL;
// this package validates the Spec against the catalog and compiles the SQL.
package card

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/catalog"
)

// Rule says what "good" means: at most / at least a value, or at most / at
// least the comparison column (budget, plan).
type Rule struct {
	Op    string   `json:"op"` // "<=" or ">="
	Value *float64 `json:"value,omitempty"`
	Vs    bool     `json:"vs,omitempty"`
}

type Spec struct {
	Question  string            `json:"question"`
	Short     string            `json:"short"`
	Table     string            `json:"table"`
	Measure   string            `json:"measure"`
	Agg       string            `json:"agg"` // sum | avg
	Filter    map[string]string `json:"filter,omitempty"`
	Vs        string            `json:"vs,omitempty"` // comparison column, e.g. budget_chf
	Good      *Rule             `json:"good,omitempty"`
	Breakdown string            `json:"breakdown,omitempty"`
	Display   string            `json:"display"` // trend | bars
}

type Card struct {
	ID      string    `json:"id"`
	Spec    Spec      `json:"spec"`
	Origin  string    `json:"origin"` // start | lumina | vorschlag | briefing
	Created time.Time `json:"created"`
	Layout  *Layout   `json:"layout,omitempty"`
}

// Layout is where a module sits on the canvas and which form it shows.
// Nil means "not placed yet": the canvas arranges it by urgency.
type Layout struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	W    float64 `json:"w"`
	H    float64 `json:"h"`
	Form string  `json:"form,omitempty"`
}

// Validate checks every name against the catalog and normalises the Spec.
// Whatever Lumina proposes, only catalog identifiers and listed values pass.
func (s *Spec) Validate(cat *catalog.Catalog) error {
	s.Question = strings.TrimSpace(s.Question)
	s.Short = strings.TrimSpace(s.Short)
	if s.Question == "" {
		return errors.New("Die Karte braucht eine Frage.")
	}
	if s.Short == "" {
		s.Short = s.Question
	}
	t := cat.Table(s.Table)
	if t == nil {
		return fmt.Errorf("Die Tabelle %q gibt es im Goldlayer nicht.", s.Table)
	}
	s.Table = t.Name
	if t.TimeColumn() == nil {
		return fmt.Errorf("Die Tabelle %s hat keine Zeitspalte.", t.Name)
	}
	m := t.Column(s.Measure)
	if m == nil || m.Role != catalog.RoleMeasure {
		return fmt.Errorf("%q ist keine Kennzahl der Tabelle %s.", s.Measure, t.Name)
	}
	s.Measure = m.Name
	switch s.Agg = strings.ToLower(s.Agg); s.Agg {
	case "sum", "avg":
	case "":
		s.Agg = "sum"
	default:
		return fmt.Errorf("Unbekannte Berechnung %q.", s.Agg)
	}
	clean := map[string]string{}
	for col, val := range s.Filter {
		c := t.Column(col)
		if c == nil || c.Role != catalog.RoleDimension {
			return fmt.Errorf("Nach %q kann man in %s nicht filtern.", col, t.Name)
		}
		ok := false
		for _, v := range c.Values {
			if strings.EqualFold(v, val) {
				clean[c.Name], ok = v, true
				break
			}
		}
		if !ok {
			return fmt.Errorf("Den Wert %q gibt es in der Spalte %s nicht.", val, c.Name)
		}
	}
	s.Filter = clean
	if s.Vs != "" {
		v := t.Column(s.Vs)
		if v == nil || v.Role != catalog.RoleMeasure || v.Name == s.Measure {
			return fmt.Errorf("Mit %q kann nicht verglichen werden.", s.Vs)
		}
		s.Vs = v.Name
	}
	if s.Good != nil {
		if s.Good.Op != "<=" && s.Good.Op != ">=" {
			return fmt.Errorf("Unbekannte Regel %q.", s.Good.Op)
		}
		if s.Good.Vs && s.Vs == "" {
			return errors.New("Die Regel vergleicht mit Budget oder Plan, aber es ist keine Vergleichsspalte gesetzt.")
		}
		if !s.Good.Vs && s.Good.Value == nil {
			return errors.New("Die Regel braucht einen Zielwert.")
		}
	}
	if s.Breakdown != "" {
		b := t.Column(s.Breakdown)
		if b == nil || b.Role != catalog.RoleDimension {
			return fmt.Errorf("Nach %q kann nicht aufgeteilt werden.", s.Breakdown)
		}
		s.Breakdown = b.Name
	}
	switch s.Display {
	case "", "trend":
		s.Display = "trend"
	case "bars":
		if s.Breakdown == "" {
			return errors.New("Ein Vergleich als Balken braucht eine Aufteilung, z. B. nach Filiale.")
		}
	default:
		return fmt.Errorf("Unbekannte Darstellung %q.", s.Display)
	}
	return nil
}

// DriverColumn is the dimension used to explain a deviation: the explicit
// breakdown, or else the first dimension the card does not filter on.
func (s *Spec) DriverColumn(t *catalog.Table) string {
	if s.Breakdown != "" {
		return s.Breakdown
	}
	for _, c := range t.Columns {
		if _, filtered := s.Filter[c.Name]; c.Role == catalog.RoleDimension && !filtered {
			return c.Name
		}
	}
	return ""
}

// FilterColumns returns the filtered columns in a stable order, so the same
// card always compiles to the same SQL.
func (s *Spec) FilterColumns() []string {
	cols := make([]string, 0, len(s.Filter))
	for col := range s.Filter {
		cols = append(cols, col)
	}
	sort.Strings(cols)
	return cols
}

// aggSQL aggregates a column as DOUBLE; filter, if set, goes directly after
// the aggregate as SQL requires: CAST(SUM(x) FILTER (WHERE …) AS DOUBLE).
func aggSQL(agg, col, filter string) string {
	fn := "SUM"
	if agg == "avg" {
		fn = "AVG"
	}
	if filter != "" {
		filter = " FILTER (WHERE " + filter + ")"
	}
	return fmt.Sprintf("CAST(%s(%s)%s AS DOUBLE)", fn, adapter.QuoteIdent(col), filter)
}

func (s *Spec) where(timeCol string, extra string) string {
	conds := []string{}
	for _, col := range s.FilterColumns() {
		conds = append(conds, fmt.Sprintf("%s = %s", adapter.QuoteIdent(col), adapter.QuoteLiteral(s.Filter[col])))
	}
	conds = append(conds, extra)
	return "WHERE " + strings.Join(conds, "\n  AND ")
}

func dateLit(d time.Time) string { return "DATE '" + d.Format("2006-01-02") + "'" }

// SeriesSQL returns one value per week (and the comparison value) for the
// last n weeks up to asOf, newest first.
func (s *Spec) SeriesSQL(cat *catalog.Catalog, asOf time.Time, n int) string {
	t := cat.Table(s.Table)
	tc := adapter.QuoteIdent(t.TimeColumn().Name)
	sel := fmt.Sprintf("SELECT %s AS t,\n       %s AS wert", tc, aggSQL(s.Agg, s.Measure, ""))
	if s.Vs != "" {
		sel += fmt.Sprintf(",\n       %s AS vergleich", aggSQL(s.Agg, s.Vs, ""))
	}
	return fmt.Sprintf("%s\nFROM %s\n%s\nGROUP BY 1\nORDER BY 1 DESC\nLIMIT %d",
		sel, adapter.QuoteTable(t.Name), s.where(tc, tc+" <= "+dateLit(asOf)), n)
}

// MatrixSQL returns one value per group and week for the last n weeks.
func (s *Spec) MatrixSQL(cat *catalog.Catalog, by string, asOf time.Time, n int) string {
	t := cat.Table(s.Table)
	tc := adapter.QuoteIdent(t.TimeColumn().Name)
	from := asOf.AddDate(0, 0, -7*n)
	return fmt.Sprintf("SELECT %s AS gruppe,\n       %s AS t,\n       %s AS wert\nFROM %s\n%s\nGROUP BY 1, 2\nORDER BY 1, 2",
		adapter.QuoteIdent(by), tc, aggSQL(s.Agg, s.Measure, ""), adapter.QuoteTable(t.Name),
		s.where(tc, fmt.Sprintf("%s <= %s AND %s > %s", tc, dateLit(asOf), tc, dateLit(from))))
}

// GroupsSQL splits the current and the previous week by one dimension.
func (s *Spec) GroupsSQL(cat *catalog.Catalog, by string, asOf, prev time.Time) string {
	t := cat.Table(s.Table)
	tc := adapter.QuoteIdent(t.TimeColumn().Name)
	in := func(d time.Time) string { return tc + " = " + dateLit(d) }
	sel := fmt.Sprintf("SELECT %s AS gruppe,\n       %s AS wert,\n       %s AS vorher",
		adapter.QuoteIdent(by), aggSQL(s.Agg, s.Measure, in(asOf)), aggSQL(s.Agg, s.Measure, in(prev)))
	if s.Vs != "" {
		sel += fmt.Sprintf(",\n       %s AS vergleich", aggSQL(s.Agg, s.Vs, in(asOf)))
	}
	return fmt.Sprintf("%s\nFROM %s\n%s\nGROUP BY 1\nORDER BY 2 DESC NULLS LAST, 1",
		sel, adapter.QuoteTable(t.Name), s.where(tc, fmt.Sprintf("%s IN (%s, %s)", tc, dateLit(asOf), dateLit(prev))))
}
