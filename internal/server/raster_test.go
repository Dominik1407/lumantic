package server

import (
	"strings"
	"testing"
)

// The standard raster travels with the figures, so the room knows in which one
// it judges; a further Kosmos keeps a raster of its own.
func TestStandardRaster(t *testing.T) {
	e := newEnv(t, true, nil)
	if code, m := e.do("GET", "/api/metrics", ""); code != 200 || m["grain"] != "monat" {
		t.Fatalf("%d %v", code, m["grain"])
	}
	if code, s := e.do("PUT", "/api/settings", `{"grain":"quartal"}`); code != 200 || s["grain"] != "quartal" {
		t.Fatalf("%d %v", code, s["grain"])
	}
	if _, m := e.do("GET", "/api/metrics", ""); m["grain"] != "quartal" {
		t.Fatalf("metrics: %v", m["grain"])
	}
	if code, out := e.do("POST", "/api/kosmen", `{"data":{"type":"duckdb","name":"Zwei","path":"zwei"}}`); code != 201 {
		t.Fatalf("%d %v", code, out)
	}
	if _, s := e.do("PUT", "/api/settings?k=zwei", `{"grain":"jahr"}`); s["grain"] != "jahr" {
		t.Fatalf("further Kosmos: %v", s["grain"])
	}
	if code, out := e.do("PUT", "/api/settings?k=zwei", `{"grain":"woche"}`); code != 422 || !strings.Contains(out["error"].(string), "Raster") {
		t.Fatalf("%d %v", code, out)
	}
	if _, s := e.do("GET", "/api/settings", ""); s["grain"] != "quartal" {
		t.Fatalf("the first keeps its own: %v", s["grain"])
	}
}

// How a flow's target spreads is Lumantic's to say, figure by figure, in the
// Sternkatalog; the standard holds until someone changes it.
func TestPhasingInTheCatalog(t *testing.T) {
	e := newEnv(t, true, nil)
	field := func(out map[string]any, id, name string) any {
		for _, x := range out["entries"].([]any) {
			if en := x.(map[string]any); en["id"] == id {
				if f, ok := en["fields"].(map[string]any)[name].(map[string]any); ok {
					return f["value"]
				}
			}
		}
		return nil
	}
	if code, out := e.do("POST", "/api/kpis", `{"id":"fluss","name":"Fluss","group":"a","unit":"Mio","kind":"flow","dir":1,"target":12,"monthly":{"table":"g.monat","value":"wert"}}`); code != 201 && code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	_, out := e.do("GET", "/api/katalog", "")
	if field(out, "fluss", "phasing") != "monate" || field(out, "fluss", "targetPer") != "monat" || field(out, "x", "phasing") != nil {
		t.Fatalf("standard: %v %v %v", field(out, "fluss", "phasing"), field(out, "fluss", "targetPer"), field(out, "x", "phasing"))
	}
	if code, out := e.do("PUT", "/api/katalog/kennzahl/fluss", `{"phasing":"quartale"}`); code != 422 {
		t.Fatalf("%d %v", code, out)
	}
	code, out := e.do("PUT", "/api/katalog/kennzahl/fluss", `{"phasing":"arbeitstage","targetPer":"jahr"}`)
	if code != 200 || field(out, "fluss", "phasing") != "arbeitstage" || field(out, "fluss", "targetPer") != "jahr" {
		t.Fatalf("%d %v %v", code, field(out, "fluss", "phasing"), field(out, "fluss", "targetPer"))
	}
}
