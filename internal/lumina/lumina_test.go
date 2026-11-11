package lumina

import (
	"context"
	"errors"
	"testing"
)

func TestOfflineMatchesLibrary(t *testing.T) {
	cases := map[string]string{
		"Sind die Marketingkosten im Budget?":          "Marketingkosten",
		"Sind die IT-Kosten im Budget?":                "IT-Kosten",
		"Wie hoch sind die IT Kosten?":                 "IT-Kosten",
		"Wie viele Kreditanträge sind offen?":          "Offene Kreditanträge",
		"Welche Filiale gewinnt am meisten Neukunden?": "Neukunden pro Filiale",
		"Wie viele Neukunden haben wir?":               "Neukunden",
		"Wie zufrieden sind die Kunden?":               "Kundenzufriedenheit",
		"Wo fallen die meisten Kosten an?":             "Kosten pro Kostenstelle",
	}
	for q, want := range cases {
		specs, err := Offline{}.Ask(context.Background(), nil, q)
		if err != nil {
			t.Errorf("%q: %v", q, err)
			continue
		}
		if got := specs[0].Short; got != want {
			t.Errorf("%q: got %q, want %q", q, got, want)
		}
	}
}

func TestOfflineRejectsUnrelatedQuestions(t *testing.T) {
	_, err := Offline{}.Ask(context.Background(), nil, "Wie ist das Wetter in Bern?")
	var na *NoAnswer
	if !errors.As(err, &na) {
		t.Fatalf("want NoAnswer, got %v", err)
	}
}

func TestOfflineReadsTargets(t *testing.T) {
	cases := map[string]struct {
		op    string
		value float64
	}{
		"Neukunden pro Woche, gut ist mehr als 150":    {">=", 150},
		"Offene Kreditanträge, höchstens 40":           {"<=", 40},
		"Wartezeit am Schalter maximal 5,5 Minuten":    {"<=", 5.5},
		"Wie viele Neukunden? Mindestens 1’200 im Mai": {">=", 1200},
	}
	for q, want := range cases {
		specs, err := Offline{}.Ask(context.Background(), nil, q)
		if err != nil {
			t.Fatalf("%q: %v", q, err)
		}
		g := specs[0].Good
		if g == nil || g.Value == nil || g.Op != want.op || *g.Value != want.value {
			t.Errorf("%q: got %+v, want %s %v", q, g, want.op, want.value)
		}
	}
}

func TestLibraryIsNotMutatedByCallers(t *testing.T) {
	a := StartBoard()
	a[0].Filter["kostenstelle"] = "Marketing"
	if b := StartBoard(); b[0].Filter["kostenstelle"] != "IT" {
		t.Fatal("StartBoard shares maps with the library")
	}
}
