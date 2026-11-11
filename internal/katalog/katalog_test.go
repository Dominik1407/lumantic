package katalog

import (
	"context"
	"strings"
	"testing"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/catalog"
	"github.com/Dominik1407/lumantic/internal/metrics"
)

// source answers the contract's three views with fixed rows.
type source struct{ rows map[string][]adapter.Row }

func (s source) Name() string    { return "fake" }
func (s source) Dialect() string { return "duckdb" }
func (s source) Describe(context.Context) (*catalog.Catalog, error) {
	return nil, nil
}
func (s source) Query(_ context.Context, sql string) ([]adapter.Row, error) {
	for table, rows := range s.rows {
		if strings.Contains(sql, table) {
			return rows, nil
		}
	}
	return nil, nil
}

func industry() *catalog.Catalog {
	col := func(n, t, desc string) catalog.Column {
		return catalog.Column{Name: n, Type: t, Role: catalog.RoleFor(t), Desc: desc}
	}
	return &catalog.Catalog{Tables: []catalog.Table{
		{Name: "gold.finanzen_monat", Columns: []catalog.Column{col("monat", "DATE", ""), col("sparte", "VARCHAR", ""),
			col("umsatz_mio", "DOUBLE", ""), col("auftragseingang_mio", "DOUBLE", "Bestellungen, die im Monat eingegangen sind.")}},
		{Name: "gold.kpi_monat", Columns: []catalog.Column{col("monat", "DATE", ""), col("oee_pct", "DOUBLE", ""), col("liefertreue_pct", "DOUBLE", ""),
			col("lagerreichweite_tage", "DOUBLE", "")}},
		{Name: "gold.lumantic_kennzahlen"}, {Name: "gold.lumantic_ziele"}, {Name: "gold.lumantic_begriffe"},
	}}
}

func companyRows() source {
	return source{rows: map[string][]adapter.Row{
		`"lumantic_kennzahlen"`: {
			{"id": "umsatz", "name": "Umsatz", "definition": "Fakturierter Umsatz ohne MWST.", "thema": "Finanzen", "einheit": "Mio. CHF", "art": "Fluss",
				"richtung": "höher ist besser", "tabelle": "gold.finanzen_monat", "wert_spalte": "umsatz_mio", "teile_spalte": "sparte", "eigner": "Finanzen"},
			{"id": "auftragseingang", "name": "Auftragseingang", "thema": "Finanzen", "tabelle": "gold.finanzen_monat", "wert_spalte": "auftragseingang_mio"},
			{"id": "oee", "name": "OEE", "definition": "Verfügbarkeit × Leistung × Qualität.", "thema": "Produktion", "einheit": "%", "art": "Bestand",
				"richtung": "hoch", "tabelle": "gold.kpi_monat", "wert_spalte": "oee_pct", "eigner": "Produktion", "berechnung": "Gutteile × Taktzeit ÷ Planzeit"},
			{"id": "geist", "name": "Geisterkennzahl", "thema": "Finanzen", "tabelle": "gold.gibtsnicht", "wert_spalte": "x"},
			{"name": ""},
		},
		`"lumantic_ziele"`: {
			{"kennzahl_id": "oee", "art": "Ziel", "wert": 75.0, "gueltig_ab": "2025-01-01", "gueltig_bis": "2025-12-31"},
			{"kennzahl_id": "oee", "art": "Ziel", "wert": "78", "gueltig_ab": "2026-01-01T00:00:00"},
			{"kennzahl_id": "oee", "art": "Grenze", "wert": 70.0},
			{"kennzahl_id": "oee", "art": "irgendwas", "wert": 1.0},
		},
		`"lumantic_begriffe"`: {
			{"begriff": "OEE", "definition": "Gesamtanlageneffektivität", "synonyme": "Anlageneffektivität; GAE", "kennzahl_id": "oee"},
		},
	}}
}

func own() *metrics.Config {
	t, l, dir := 40.0, 60.0, -1
	return &metrics.Config{Title: "Industrie", Groups: []metrics.Group{{ID: "logistik", Name: "Logistik"}},
		KPIs: []metrics.Def{{ID: "reichweite", Group: "logistik", Name: "Lagerreichweite", Unit: "Tage", Kind: "stock", Dir: -1, Limit: &l,
			Desc: "Wie viele Tage der Lagerbestand reicht.", Monthly: metrics.Source{Table: "gold.kpi_monat", Value: "lagerreichweite_tage"}}},
		Extra: map[string]metrics.Extra{
			"umsatz":          {Target: &t, TargetName: "Monatsziel", Desc: "darf das nicht überschreiben", Dir: &dir},
			"auftragseingang": {Desc: "Neue Bestellungen im Monat.", Owner: "Vertrieb"},
		},
		Terms: []metrics.Term{{Term: "Lagerreichweite", Definition: "Bestand ÷ Verbrauch pro Tag"}, {Term: "oee", Definition: "doppelt"}},
	}
}

func TestReadAndMergeKeepTheOrigins(t *testing.T) {
	cat := industry()
	company, err := Read(context.Background(), companyRows(), cat)
	if err != nil || company == nil || company.Table != "gold.lumantic_kennzahlen" {
		t.Fatalf("%v %v", company, err)
	}
	if len(company.KPIs) != 4 || len(company.Problems) != 2 {
		t.Fatalf("rows: %d, problems %v", len(company.KPIs), company.Problems)
	}
	merged, problems := Merge(company, own(), cat)
	ids := []string{}
	for _, k := range merged.KPIs {
		ids = append(ids, k.ID)
	}
	if strings.Join(ids, ",") != "umsatz,auftragseingang,oee,geist,reichweite" {
		t.Fatalf("figures: %v", ids)
	}
	if !strings.Contains(strings.Join(problems, " "), "Geisterkennzahl: im Goldlayer fehlt gold.gibtsnicht") {
		t.Fatalf("problems: %v", problems)
	}
	by := map[string]metrics.Def{}
	for _, k := range merged.KPIs {
		by[k.ID] = k
	}
	o := merged.Origins
	// Umsatz: the catalog's words win; Lumantic adds only the target the catalog lacks.
	u := by["umsatz"]
	if u.Desc != "Fakturierter Umsatz ohne MWST." || o["umsatz"]["desc"] != FromSource || u.Dir != 1 || o["umsatz"]["dir"] != FromSource {
		t.Errorf("umsatz words: %q dir %d %v", u.Desc, u.Dir, o["umsatz"])
	}
	if u.Target == nil || *u.Target != 40 || o["umsatz"]["target"] != FromLumantic || u.TargetName != "Monatsziel" || u.Parts == nil || u.Parts.Split != "sparte" {
		t.Errorf("umsatz target: %+v %v", u, o["umsatz"])
	}
	// Auftragseingang: no unit, kind or direction in the catalog; definition and owner from Lumantic.
	a := by["auftragseingang"]
	if a.Unit != "Mio" || o["auftragseingang"]["unit"] != Guessed || a.Kind != "flow" || o["auftragseingang"]["kind"] != Guessed || o["auftragseingang"]["dir"] != Guessed {
		t.Errorf("guessed: %+v %v", a, o["auftragseingang"])
	}
	if a.Desc != "Neue Bestellungen im Monat." || o["auftragseingang"]["desc"] != FromLumantic || a.Owner != "Vertrieb" {
		t.Errorf("added: %+v", a)
	}
	// OEE: targets that change over time and a limit, all from the catalog.
	e := by["oee"]
	if len(e.Bounds) != 3 || e.Bounds[1].From != "2026-01-01" || e.Bounds[1].Value != 78 || o["oee"]["target"] != FromSource || o["oee"]["limit"] != FromSource || e.Dec != 1 {
		t.Errorf("oee: %+v %v", e.Bounds, o["oee"])
	}
	// Lumantic's own figure stays its own.
	if r := by["reichweite"]; o["reichweite"]["unit"] != FromLumantic || r.Limit == nil {
		t.Errorf("reichweite: %v", o["reichweite"])
	}
	groups := map[string]bool{}
	for _, g := range merged.Groups {
		groups[g.ID+"="+g.Name] = true
	}
	if !groups["finanzen=Finanzen"] || !groups["produktion=Produktion"] || !groups["logistik=Logistik"] {
		t.Errorf("topics: %v", merged.Groups)
	}
	if len(merged.Terms) != 2 || merged.Terms[0].Origin != FromSource || merged.Terms[0].Synonyms[1] != "GAE" || merged.Terms[1].Term != "Lagerreichweite" || merged.Terms[1].Origin != FromLumantic {
		t.Errorf("terms: %+v", merged.Terms)
	}
	// own is untouched: the next merge starts from the file as it is.
	if own := own(); len(own.KPIs) != 1 {
		t.Fatal("own changed")
	}
}

func TestWithoutCompanyCatalogAllIsLumantic(t *testing.T) {
	cat := &catalog.Catalog{Tables: []catalog.Table{{Name: "gold.kpi_monat"}}}
	company, err := Read(context.Background(), source{}, cat)
	if company != nil || err != nil {
		t.Fatalf("%v %v", company, err)
	}
	merged, problems := Merge(nil, own(), cat)
	if len(problems) != 0 || merged.Origins["reichweite"]["name"] != FromLumantic || merged.Terms[0].Origin != FromLumantic {
		t.Fatalf("%v %v", problems, merged.Origins)
	}
}

func TestGuessesFromColumnNames(t *testing.T) {
	cases := map[string][2]string{
		"oee_pct": {"%", "stock"}, "umsatz_mio": {"Mio", "flow"}, "lagerwert_mio": {"Mio", "stock"}, "gutteile_stk": {"Stk", "flow"},
		"reichweite_tage": {"Tage", "stock"}, "laufzeit_h": {"h", "flow"}, "kunden": {"Zahl", "stock"}, "ebit_marge": {"%", "stock"},
	}
	for col, want := range cases {
		u := UnitOfColumn(col)
		if u != want[0] || KindOf(u, col) != want[1] {
			t.Errorf("%s: %s %s", col, u, KindOf(u, col))
		}
	}
	for in, want := range map[string]string{"Mio. CHF": "Mio", "Prozent": "%", "Stück": "Stk", "Tage": "Tage", "Stunden": "h", "CHF Mrd": "Mrd", "Kilogramm": ""} {
		if got := unitFrom(in); got != want {
			t.Errorf("unit %q: %q", in, got)
		}
	}
	if !IsContract("LUMANTIC.LUMANTIC_ZIELE") || IsContract("gold.kpi_monat") {
		t.Error("IsContract")
	}
}

func TestExportWritesTheContract(t *testing.T) {
	cat := industry()
	company, _ := Read(context.Background(), companyRows(), cat)
	merged, _ := Merge(company, own(), cat)
	sql := SQL(merged, "", adapter.DialectFor("duckdb"))
	for _, want := range []string{
		`CREATE SCHEMA IF NOT EXISTS "lumantic";`,
		`CREATE OR REPLACE VIEW "lumantic"."lumantic_kennzahlen" AS`,
		`('umsatz', 'Umsatz', 'Fakturierter Umsatz ohne MWST.', 'Finanzen', 'Mio. CHF', 'Fluss', 'höher ist besser', 'gold.finanzen_monat', 'umsatz_mio', NULL, 'sparte', 'Finanzen', NULL)`,
		`('umsatz', 'Ziel', 40, 'Monatsziel', NULL, NULL, 'Monat')`, // a flow says what time its target covers
		`('oee', 'Ziel', 78, NULL, '2026-01-01', NULL, NULL)`,
		`('reichweite', 'Grenze', 60, NULL, NULL, NULL, NULL)`,
		`('OEE', 'Gesamtanlageneffektivität', 'Anlageneffektivität; GAE', 'oee')`,
		`) AS t("begriff", "definition", "synonyme", "kennzahl_id");`,
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("missing %s\n%s", want, sql)
		}
	}
	if strings.Count(sql, "CREATE OR REPLACE VIEW") != 3 {
		t.Errorf("three views:\n%s", sql)
	}
}

// «Durchschnitt» and «Verhältnis» are kinds a company catalog may name. A ratio
// without numerator and denominator is averaged, and the catalog says so.
func TestAveragesAndRatiosFromTheCatalog(t *testing.T) {
	for in, want := range map[string]string{"Durchschnitt": "avg", "Ø": "avg", "Mittelwert": "avg", "Verhältnis": "ratio", "Quote": "ratio", "Bestand": "stock", "irgendwie": ""} {
		if got := kindFrom(in); got != want {
			t.Errorf("kind %q: %q", in, got)
		}
	}
	rows := companyRows()
	rows.rows[`"lumantic_kennzahlen"`][2]["art"] = "Verhältnis"
	cat := industry()
	company, err := Read(context.Background(), rows, cat)
	if err != nil {
		t.Fatal(err)
	}
	merged, problems := Merge(company, own(), cat)
	for _, k := range merged.KPIs {
		if k.ID == "oee" && k.Kind != "avg" {
			t.Errorf("oee: %s", k.Kind)
		}
	}
	if !strings.Contains(strings.Join(problems, " "), "OEE: Ein Verhältnis braucht Zähler und Nenner") {
		t.Fatalf("problems: %v", problems)
	}
	// With its parts from Lumantic's own definitions it stays a ratio.
	mine := own()
	mine.KPIs = append(mine.KPIs, metrics.Def{ID: "oee", Group: "logistik", Name: "OEE", Unit: "%", Kind: "ratio", Monthly: metrics.Source{Table: "gold.kpi_monat", Value: "oee_pct"},
		Parts: &metrics.Parts{Mode: "ratio", Columns: []metrics.PartColumn{{Name: "Gut", Column: "oee_pct"}, {Name: "Plan", Column: "liefertreue_pct"}}}})
	merged, problems = Merge(company, mine, cat)
	for _, k := range merged.KPIs {
		if k.ID == "oee" && (k.Kind != "ratio" || k.Parts == nil) {
			t.Errorf("oee with parts: %s %+v", k.Kind, k.Parts)
		}
	}
	if strings.Contains(strings.Join(problems, " "), "Zähler und Nenner") {
		t.Fatalf("problems: %v", problems)
	}
}
