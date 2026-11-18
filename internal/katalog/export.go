package katalog

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/metrics"
)

// How the contract writes units, kinds and directions in words.
var (
	unitWords = map[string]string{"%": "%", "Mio": "Mio. CHF", "Mrd": "Mrd. CHF", "Tsd": "Tsd. CHF", "Stk": "Stück", "Tage": "Tage", "h": "Stunden", "Zahl": "Zahl"}
	kindWords = map[string]string{"stock": "Bestand", "flow": "Fluss", "avg": "Durchschnitt", "ratio": "Verhältnis"}
	perWords  = map[string]string{"jahr": "Jahr", "monat": "Monat"}
	dirWords  = map[int]string{1: "höher ist besser", -1: "tiefer ist besser", 0: "neutral"}
)

// SQL writes a catalog as the contract's three views in schema, in the SQL of
// d, ready to run in the gold layer. A team that takes over a catalog begun in
// Lumantic runs it once; from then on Lumantic reads it as the company catalog.
func SQL(c *metrics.Config, schema string, d adapter.Dialect) string {
	if schema == "" {
		schema = "lumantic"
	}
	lit := func(s string) string {
		if s == "" {
			return "NULL"
		}
		return d.Literal(s)
	}
	num := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
	// English words go out as the contract's _en columns, when there are any.
	english, termsEn := false, false
	groups, groupsEn := map[string]string{}, map[string]string{}
	for _, g := range c.Groups {
		groups[g.ID], groupsEn[g.ID] = g.Name, g.En["name"]
		english = english || g.En["name"] != ""
	}
	for _, k := range c.KPIs {
		english = english || k.En["name"] != "" || k.En["desc"] != "" || k.En["formula"] != ""
	}
	for _, t := range c.Terms {
		termsEn = termsEn || len(t.En) > 0
	}
	var b strings.Builder
	fmt.Fprintf(&b, "-- Fachkatalog für Lumantic, aus Lumantic exportiert.\n-- Lumantic liest ihn danach als Unternehmenskatalog (Vertrag: config/README.md, «Katalog»).\n")
	fmt.Fprintf(&b, "CREATE SCHEMA IF NOT EXISTS %s;\n\n", d.Ident(schema))

	view := func(name string, cols []string, rows [][]string) {
		if len(rows) == 0 {
			fmt.Fprintf(&b, "-- %s: keine Einträge\n\n", name)
			return
		}
		fmt.Fprintf(&b, "CREATE OR REPLACE VIEW %s.%s AS\nSELECT * FROM (VALUES\n", d.Ident(schema), d.Ident(name))
		for i, r := range rows {
			sep := ","
			if i == len(rows)-1 {
				sep = ""
			}
			fmt.Fprintf(&b, "  (%s)%s\n", strings.Join(r, ", "), sep)
		}
		quoted := make([]string, len(cols))
		for i, col := range cols {
			quoted[i] = d.Ident(col)
		}
		fmt.Fprintf(&b, ") AS t(%s);\n\n", strings.Join(quoted, ", "))
	}

	var kpis, bounds [][]string
	for _, k := range c.KPIs {
		split := ""
		if k.Parts != nil {
			split = k.Parts.Split
		}
		row := []string{lit(k.ID), lit(k.Name), lit(k.Desc), lit(groups[k.Group]), lit(unitWords[k.Unit]), lit(kindWords[k.Kind]),
			lit(dirWords[k.Dir]), lit(k.Monthly.Table), lit(k.Monthly.Value), lit(k.Monthly.Time), lit(split), lit(k.Owner), lit(k.Formula)}
		if english {
			row = append(row, lit(k.En["name"]), lit(k.En["desc"]), lit(groupsEn[k.Group]), lit(k.En["formula"]))
		}
		kpis = append(kpis, row)
		// A target or limit keeps its English name in English.
		bound := func(row []string, en string) []string {
			if english {
				row = append(row, lit(en))
			}
			return row
		}
		// A flow's target says what time it covers; a single target of Lumantic's holds per month unless it says otherwise.
		per := func(p string, isTarget bool) string {
			switch {
			case k.Kind != "flow":
				return "NULL"
			case p == "":
				if isTarget {
					return lit("Jahr")
				}
				return lit("Monat")
			}
			return lit(perWords[p])
		}
		single := k.TargetPer
		if single == "" {
			single = "monat"
		}
		if k.Target != nil {
			bounds = append(bounds, bound([]string{lit(k.ID), lit("Ziel"), num(*k.Target), lit(k.TargetName), "NULL", "NULL", per(single, true)}, k.En["targetName"]))
		}
		if k.Limit != nil {
			bounds = append(bounds, bound([]string{lit(k.ID), lit("Grenze"), num(*k.Limit), lit(k.LimitName), "NULL", "NULL", per("monat", false)}, k.En["limitName"]))
		}
		for _, bd := range k.Bounds {
			kind := "Ziel"
			if bd.Kind == "grenze" {
				kind = "Grenze"
			}
			bounds = append(bounds, bound([]string{lit(k.ID), lit(kind), num(bd.Value), lit(bd.Name), lit(bd.From), lit(bd.Until), per(bd.Per, bd.Kind == "ziel")}, bd.En["name"]))
		}
	}
	cols := []string{"id", "name", "definition", "thema", "einheit", "art", "richtung", "tabelle", "wert_spalte", "zeit_spalte", "teile_spalte", "eigner", "berechnung"}
	boundCols := []string{"kennzahl_id", "art", "wert", "name", "gueltig_ab", "gueltig_bis", "periode"}
	if english {
		cols = append(cols, "name_en", "definition_en", "thema_en", "berechnung_en")
		boundCols = append(boundCols, "name_en")
	}
	view(TableKPIs, cols, kpis)
	view(TableBounds, boundCols, bounds)
	var terms [][]string
	for _, t := range c.Terms {
		row := []string{lit(t.Term), lit(t.Definition), lit(strings.Join(t.Synonyms, "; ")), lit(t.KPI)}
		if termsEn {
			row = append(row, lit(t.En["term"]), lit(t.En["definition"]))
		}
		terms = append(terms, row)
	}
	cols = []string{"begriff", "definition", "synonyme", "kennzahl_id"}
	if termsEn {
		cols = append(cols, "begriff_en", "definition_en")
	}
	view(TableTerms, cols, terms)
	return b.String()
}
