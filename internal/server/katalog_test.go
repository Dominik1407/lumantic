package server

import (
	"context"
	"os"
	"strings"
	"testing"

	"lumantic/internal/adapter"
	"lumantic/internal/catalog"
	"lumantic/internal/config"
)

// catalogSource is a gold layer that keeps a company catalog: one figure,
// its target from February 2026 on.
type catalogSource struct{ *fakeSource }

func (c catalogSource) Describe(ctx context.Context) (*catalog.Catalog, error) {
	cat, _ := c.fakeSource.Describe(ctx)
	cat.Tables = append(cat.Tables, catalog.Table{Name: "g.lumantic_kennzahlen"}, catalog.Table{Name: "g.lumantic_ziele"})
	return cat, nil
}

func (c catalogSource) Query(ctx context.Context, sql string) ([]adapter.Row, error) {
	switch {
	case strings.Contains(sql, "lumantic_kennzahlen"):
		return []adapter.Row{{"id": "kredite", "name": "Kreditvolumen", "definition": "Aus der Quelle.", "thema": "Bilanz", "einheit": "Mio. CHF",
			"art": "Bestand", "richtung": "höher ist besser", "tabelle": "g.monat", "wert_spalte": "kredite"}}, nil
	case strings.Contains(sql, "lumantic_ziele"):
		return []adapter.Row{{"kennzahl_id": "kredite", "art": "Ziel", "wert": 950.0, "gueltig_ab": "2026-02-01"}}, nil
	}
	return c.fakeSource.Query(ctx, sql)
}

func katalogEnv(t *testing.T) *env {
	t.Helper()
	e := newEnv(t, true, nil)
	fake := e.srv.BuildSource
	e.srv.BuildSource = func(d config.Data, secret func(string) string) (adapter.Adapter, error) {
		if d.Path == "katalog" {
			return catalogSource{&fakeSource{name: d.Path}}, nil
		}
		return fake(d, secret)
	}
	if code, out := e.do("PUT", "/api/settings", `{"data":{"path":"katalog"}}`); code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	return e
}

func entryOf(out map[string]any, id string) map[string]any {
	for _, x := range out["entries"].([]any) {
		if e := x.(map[string]any); e["id"] == id {
			return e
		}
	}
	return nil
}

func TestTheCompanyCatalogBuildsTheKosmos(t *testing.T) {
	e := katalogEnv(t)
	_, out := e.do("GET", "/api/katalog", "")
	if out["company"] != "g.lumantic_kennzahlen" || out["editable"] != true {
		t.Fatalf("katalog: %v", out)
	}
	kr := entryOf(out, "kredite")
	if kr == nil || get(kr, "fields.desc.value") != "Aus der Quelle." || get(kr, "fields.desc.from") != "quelle" || get(kr, "topic") != "Bilanz" {
		t.Fatalf("kredite: %v", kr)
	}
	if get(kr, "fields.unit.from") != "quelle" || get(kr, "fields.owner.from") != "lumantic" || len(kr["bounds"].([]any)) != 1 || kr["first"] != "2026-01" {
		t.Fatalf("kredite fields: %v", kr)
	}
	if x := entryOf(out, "x"); x == nil || get(x, "fields.desc.from") != "lumantic" {
		t.Fatalf("lumantic's own figure: %v", x)
	}
	for _, tb := range out["tables"].([]any) {
		if strings.Contains(tb.(map[string]any)["name"].(string), "lumantic_") {
			t.Fatal("the contract is meaning, not a table to read figures from")
		}
	}
	// The target that holds from February on reaches the figures month by month.
	_, m := e.do("GET", "/api/metrics", "")
	var kpi map[string]any
	for _, x := range m["kpis"].([]any) {
		if x.(map[string]any)["id"] == "kredite" {
			kpi = x.(map[string]any)
		}
	}
	targets, _ := kpi["targets"].([]any)
	if kpi == nil || len(targets) != 3 || targets[0] != nil || targets[1].(float64) != 950 || kpi["target"].(float64) != 950 {
		t.Fatalf("figure: %v", kpi)
	}
	if _, c := e.do("GET", "/api/catalog", ""); strings.Contains(mustJSON(c), "lumantic_") {
		t.Fatal("technical catalog shows the contract")
	}
}

func TestLumanticAddsOnlyWhatTheCatalogLeavesOpen(t *testing.T) {
	e := katalogEnv(t)
	if code, out := e.do("PUT", "/api/katalog/kennzahl/kredite", `{"desc":"meine Worte"}`); code != 409 || !strings.Contains(out["error"].(string), "Fachkatalog") {
		t.Fatalf("the catalog's words: %d %v", code, out)
	}
	if code, out := e.do("PUT", "/api/katalog/kennzahl/kredite", `{"target":1}`); code != 409 {
		t.Fatalf("the catalog's target: %d %v", code, out)
	}
	code, out := e.do("PUT", "/api/katalog/kennzahl/kredite", `{"owner":"Treasury","limit":800,"limitName":"Minimum"}`)
	kr := entryOf(out, "kredite")
	if code != 200 || get(kr, "fields.owner.value") != "Treasury" || get(kr, "fields.owner.from") != "lumantic" || get(kr, "fields.limit.value").(float64) != 800 {
		t.Fatalf("addition: %d %v", code, kr)
	}
	if code, out := e.do("PUT", "/api/katalog/kennzahl/x", `{"formula":"Wert ÷ 1"}`); code != 200 || get(entryOf(out, "x"), "fields.formula.value") != "Wert ÷ 1" {
		t.Fatalf("own figure: %d %v", code, out)
	}
	if code, out := e.do("PUT", "/api/kpis/kredite", `{"target":12}`); code != 404 || !strings.Contains(out["error"].(string), "Sternkatalog") {
		t.Fatalf("the settings point to the Sternkatalog: %d %v", code, out)
	}
	code, out = e.do("PUT", "/api/katalog/begriffe", `{"terms":[{"term":"Kredit","definition":"Geliehenes Geld","synonyms":["Darlehen"," "]},{"term":""}]}`)
	terms := out["terms"].([]any)
	if code != 200 || len(terms) != 1 || get(terms[0].(map[string]any), "origin") != "lumantic" {
		t.Fatalf("terms: %d %v", code, out["terms"])
	}
	if code, _ := e.do("PUT", "/api/katalog/begriffe", `{"terms":[{"term":"Leer"}]}`); code != 422 {
		t.Fatalf("a word needs its meaning: %d", code)
	}
	// What Lumantic adds is kept as an addition in its own file, beside its own figure.
	raw, _ := os.ReadFile(e.srv.Config.Effective().Metrics)
	if !strings.Contains(string(raw), `"extra"`) || !strings.Contains(string(raw), `"Treasury"`) || strings.Contains(string(raw), "Aus der Quelle") {
		t.Fatalf("own file: %s", raw)
	}
	req := httptestRequest("GET", "/api/katalog/export")
	rec := serve(e, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `CREATE OR REPLACE VIEW "lumantic"."lumantic_kennzahlen"`) || !strings.Contains(rec.Body.String(), "'Treasury'") {
		t.Fatalf("export: %d %s", rec.Code, rec.Body.String())
	}
}

// Lumina learns what the figures asked about mean, and the team's words.
func TestLuminaGetsTheMeaning(t *testing.T) {
	e := katalogEnv(t)
	e.do("PUT", "/api/katalog/begriffe", `{"terms":[{"term":"Ausleihungen","definition":"Kredite an Kunden","synonyms":["Kreditbuch"],"kpi":"kredite"},{"term":"Geheim","definition":"zu einer anderen Kennzahl","kpi":"y"}]}`)
	if code, _ := e.do("PUT", "/api/settings/secret", `{"key":"anthropicToken","value":"sk-ant-api-1234wxyz"}`); code != 200 {
		t.Fatalf("token: %d", code)
	}
	code, out := e.do("POST", "/api/lumina/ask", `{"question":"Wie steht das Kreditbuch?","month":"2026-03","facts":{"month":"2026-03","figures":[{"id":"kredite","name":"Kreditvolumen"}]}}`)
	if code != 200 || len(e.lum.asked) != 1 {
		t.Fatalf("%d %v", code, out)
	}
	q := e.lum.asked[0]
	if q.Facts.Figures[0].Definition != "Aus der Quelle." || len(q.Words) != 1 || q.Words[0].Synonyms[0] != "Kreditbuch" {
		t.Fatalf("meaning: %+v %+v", q.Facts.Figures[0], q.Words)
	}
}
