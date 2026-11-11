package engine

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/card"
	"github.com/Dominik1407/lumantic/internal/catalog"
)

// Matrix is a card split by one dimension over time: weeks × groups.
type Matrix struct {
	By     string      `json:"by"`
	Unit   string      `json:"unit"`
	Weeks  []string    `json:"weeks"`
	Groups []MatrixRow `json:"groups"`
	SQL    string      `json:"sql"`
}

type MatrixRow struct {
	Name   string     `json:"name"`
	Values []*float64 `json:"values"` // nil where a week has no data
}

func BuildMatrix(ctx context.Context, ad adapter.Adapter, cat *catalog.Catalog, s card.Spec, by string, asOf time.Time) (*Matrix, error) {
	t := cat.Table(s.Table)
	if t == nil {
		return nil, errors.New("Diese Daten gibt es im Goldlayer nicht mehr.")
	}
	if by == "" {
		by = s.DriverColumn(t)
	}
	if c := t.Column(by); c == nil || c.Role != catalog.RoleDimension {
		return nil, errors.New("Nach dieser Spalte kann nicht aufgeteilt werden.")
	}
	sql := s.MatrixSQL(cat, by, asOf, window)
	rows, err := ad.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	m := &Matrix{By: by, Unit: t.Column(s.Measure).Unit, SQL: sql}
	weekIndex := map[string]int{}
	for _, r := range rows {
		weekIndex[adapter.String(r, "t")] = 0
	}
	for w := range weekIndex {
		m.Weeks = append(m.Weeks, w)
	}
	sort.Strings(m.Weeks)
	for i, w := range m.Weeks {
		weekIndex[w] = i
	}
	byName := map[string]*MatrixRow{}
	for _, r := range rows {
		name := adapter.String(r, "gruppe")
		row := byName[name]
		if row == nil {
			row = &MatrixRow{Name: name, Values: make([]*float64, len(m.Weeks))}
			byName[name] = row
		}
		if v, ok := adapter.Float(r, "wert"); ok {
			row.Values[weekIndex[adapter.String(r, "t")]] = &v
		}
	}
	for _, row := range byName {
		m.Groups = append(m.Groups, *row)
	}
	// Largest group in the latest week first.
	latest := func(r MatrixRow) float64 {
		if n := len(r.Values); n > 0 && r.Values[n-1] != nil {
			return *r.Values[n-1]
		}
		return 0
	}
	sort.SliceStable(m.Groups, func(a, b int) bool {
		if la, lb := latest(m.Groups[a]), latest(m.Groups[b]); la != lb {
			return la > lb
		}
		return m.Groups[a].Name < m.Groups[b].Name
	})
	return m, nil
}
