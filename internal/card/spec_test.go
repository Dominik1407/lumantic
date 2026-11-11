package card

import (
	"strings"
	"testing"
	"time"

	"lumantic/internal/catalog"
)

var testCatalog = &catalog.Catalog{Tables: []catalog.Table{{
	Name: "gold_retail.kosten",
	Columns: []catalog.Column{
		{Name: "woche", Role: catalog.RoleTime},
		{Name: "kostenstelle", Role: catalog.RoleDimension, Values: []string{"IT", "Marketing"}},
		{Name: "ist_chf", Role: catalog.RoleMeasure},
		{Name: "budget_chf", Role: catalog.RoleMeasure},
	},
}}}

func valid() Spec {
	return Spec{Question: "Sind die IT-Kosten im Budget?", Table: "gold_retail.kosten", Measure: "ist_chf",
		Filter: map[string]string{"kostenstelle": "it"}, Vs: "budget_chf", Good: &Rule{Op: "<=", Vs: true}}
}

func TestValidateNormalises(t *testing.T) {
	s := valid()
	if err := s.Validate(testCatalog); err != nil {
		t.Fatal(err)
	}
	if s.Filter["kostenstelle"] != "IT" || s.Agg != "sum" || s.Display != "trend" || s.Short == "" {
		t.Fatalf("not normalised: %+v", s)
	}
}

// Whatever Lumina proposes, only catalog identifiers and listed values may reach SQL.
func TestValidateRejectsAnythingOutsideTheCatalog(t *testing.T) {
	cases := map[string]func(*Spec){
		"unknown table":        func(s *Spec) { s.Table = "gold_retail.kunden; DROP TABLE x" },
		"unknown measure":      func(s *Spec) { s.Measure = "ist_chf) FROM secrets --" },
		"dimension as measure": func(s *Spec) { s.Measure = "kostenstelle" },
		"unlisted value":       func(s *Spec) { s.Filter = map[string]string{"kostenstelle": "IT' OR '1'='1"} },
		"filter on a measure":  func(s *Spec) { s.Filter = map[string]string{"ist_chf": "1"} },
		"vs equals measure":    func(s *Spec) { s.Vs = "ist_chf" },
		"bad rule":             func(s *Spec) { s.Good = &Rule{Op: "=="} },
		"bars without split":   func(s *Spec) { s.Display = "bars" },
	}
	for name, mutate := range cases {
		s := valid()
		mutate(&s)
		if err := s.Validate(testCatalog); err == nil {
			t.Errorf("%s: accepted %+v", name, s)
		}
	}
}

func TestSQLIsQuotedAndStable(t *testing.T) {
	s := valid()
	if err := s.Validate(testCatalog); err != nil {
		t.Fatal(err)
	}
	asOf := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
	sql := s.SeriesSQL(testCatalog, asOf, 14)
	for _, want := range []string{`FROM "gold_retail"."kosten"`, `"kostenstelle" = 'IT'`, `"woche" <= DATE '2026-11-02'`, "LIMIT 14"} {
		if !strings.Contains(sql, want) {
			t.Errorf("SQL lacks %s:\n%s", want, sql)
		}
	}
	if sql != s.SeriesSQL(testCatalog, asOf, 14) {
		t.Error("same card compiled to different SQL")
	}
	g := s.GroupsSQL(testCatalog, "kostenstelle", asOf, asOf.AddDate(0, 0, -7))
	if !strings.Contains(g, `CAST(SUM("ist_chf") FILTER (WHERE "woche" = DATE '2026-11-02') AS DOUBLE)`) {
		t.Errorf("FILTER must follow the aggregate:\n%s", g)
	}
}
