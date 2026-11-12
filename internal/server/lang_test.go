package server

import (
	"encoding/json"
	"testing"
)

// In English the server's messages come in English, the words a team wrote in
// English go along with the figures, and Lumina is asked to answer in English.
func TestEnglish(t *testing.T) {
	e := newEnv(t, true, map[string]string{"ANTHROPIC_API_KEY": "sk-ant-env-0000abcd"})
	if code, out := e.do("GET", "/api/metrics?k=nirgends", "", "Accept-Language", "en"); code != 404 || out["error"] != "This Kosmos does not exist." {
		t.Fatalf("%d %v", code, out)
	}
	if code, out := e.do("GET", "/api/metrics?k=nirgends", "", "Accept-Language", "de-CH,en;q=0.8"); code != 404 || out["error"] != "Diesen Kosmos gibt es nicht." {
		t.Fatalf("German stays German: %d %v", code, out)
	}
	if code, out := e.do("PUT", "/api/settings", `{"ui":{"language":"fr"}}`, "Accept-Language", "en"); code != 422 || out["error"] != "The language is de, en, or empty for the browser's." {
		t.Fatalf("language: %d %v", code, out)
	}
	if code, out := e.do("PUT", "/api/settings", `{"ui":{"language":"en"}}`); code != 200 || get(out, "ui.language") != "en" {
		t.Fatalf("saving the language: %d %v", code, out)
	}

	// What people write is never translated, even when it reads like a message.
	e.do("PUT", "/api/workspace", `{"notiz":"Das Ziel","satz":"Der Markt antwortet mit Zurückhaltung."}`)
	if _, w := e.do("GET", "/api/workspace", "", "Accept-Language", "en"); w["notiz"] != "Das Ziel" || w["satz"] != "Der Markt antwortet mit Zurückhaltung." {
		t.Fatalf("the workspace was translated: %v", w)
	}

	_, m := e.do("GET", "/api/metrics", "", "Accept-Language", "en")
	k := m["kpis"].([]any)[0].(map[string]any)
	if k["name"] != "Wert" || get(k, "en.name") != "Value" || get(m, "en.title") != "Test EN" || get(m["groups"].([]any)[0].(map[string]any), "en.name") != "A EN" {
		raw, _ := json.Marshal(m["kpis"])
		t.Fatalf("the English words travel along: %s %v", raw, m["en"])
	}

	facts := `"month":"2026-03","facts":{"title":"Test","month":"Mar 2026","figures":[{"id":"x","name":"Value","unit":"%","value":12,"prev":11,"target":11,"level":"calm","last13":[10,11,12]}]}`
	e.do("POST", "/api/lumina/ask", `{"question":"How is the value?","lang":"de",`+facts+`}`, "Accept-Language", "en")
	e.do("POST", "/api/lumina/ask", `{"question":"Wie steht der Wert?","lang":"en",`+facts+`}`)
	if len(e.lum.asked) != 2 || e.lum.asked[0].Lang != "en" || e.lum.asked[1].Lang != "de" {
		t.Fatalf("Lumina's language comes from the interface: %+v", e.lum.asked)
	}
}
