package ai

import (
	"errors"
	"testing"
)

func question() Question {
	return Question{Question: "Warum sinkt die LCR?", Month: "2026-10",
		Facts: Facts{Month: "Oktober 2026", Figures: []Figure{{ID: "lcr", Name: "LCR"}, {ID: "nnm", Name: "Netto-Neugeld"}}}}
}

func TestParseKeepsOnlyShowableBlocks(t *testing.T) {
	text := `{"fits":true,"answer":" Die LCR sinkt seit neun Monaten. ","blocks":[
		{"figure":"lcr","view":"drivers","month":""},
		{"figure":"lcr","view":"drivers","month":""},
		{"figure":"cet1","view":"trend","month":""},
		{"figure":"nnm","view":"torte","month":""},
		{"figure":"nnm","view":"cum","month":"2026-13"},
		{"figure":"nnm","view":"parts","month":"2025-10"},
		{"figure":"lcr","view":"trend","month":""},
		{"figure":"lcr","view":"buffer","month":""}]}`
	a, err := Parse(text, question())
	if err != nil {
		t.Fatal(err)
	}
	if a.Answer != "Die LCR sinkt seit neun Monaten." || len(a.Blocks) != 3 {
		t.Fatalf("%+v", a)
	}
	if a.Blocks[0].View != "drivers" || a.Blocks[1].Month != "2025-10" || a.Blocks[2].View != "trend" {
		t.Fatalf("blocks %+v", a.Blocks)
	}
}

func TestParseNoFit(t *testing.T) {
	_, err := Parse(`{"fits":false,"answer":"Dazu gibt es keine Zahlen, nur zu Liquidität und Kapital.","blocks":[]}`, question())
	var nf *NoFit
	if !errors.As(err, &nf) || nf.Msg == "" {
		t.Fatalf("got %v", err)
	}
	if _, err := Parse("kein json", question()); err == nil {
		t.Fatal("garbage accepted")
	}
}
