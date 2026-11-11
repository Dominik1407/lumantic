package lumina

import "github.com/Dominik1407/lumantic/internal/card"

// entry is a ready-made question for the demo gold layer. The library is the
// start board, the source of suggestions, and the offline fallback when no
// Claude credentials are configured.
type entry struct {
	Key      string
	Start    bool
	Keywords []string
	Spec     card.Spec
}

func num(v float64) *float64 { return &v }

var library = []entry{
	{"it-kosten", true, []string{"it", "it-kosten", "it kosten", "informatik", "lizenz", "hardware"}, card.Spec{
		Question: "Sind die IT-Kosten im Budget?", Short: "IT-Kosten",
		Table: "gold_retail.kosten", Measure: "ist_chf", Agg: "sum",
		Filter: map[string]string{"kostenstelle": "IT"}, Vs: "budget_chf",
		Good: &card.Rule{Op: "<=", Vs: true}, Breakdown: "kategorie", Display: "trend"}},
	{"kredite-offen", true, []string{"kredit", "antrag", "anträge", "offen", "pendent", "rückstand"}, card.Spec{
		Question: "Wie viele Kreditanträge sind noch offen?", Short: "Offene Kreditanträge",
		Table: "gold_retail.kreditantraege", Measure: "offen", Agg: "sum",
		Good: &card.Rule{Op: "<=", Value: num(50)}, Breakdown: "filiale", Display: "trend"}},
	{"neukunden", true, []string{"neukunden", "kunden", "gewinnen", "eröffnet", "kundenbeziehung"}, card.Spec{
		Question: "Wie viele Neukunden gewinnen wir pro Woche?", Short: "Neukunden",
		Table: "gold_retail.neukunden", Measure: "neukunden", Agg: "sum",
		Good: &card.Rule{Op: ">=", Value: num(130)}, Breakdown: "filiale", Display: "trend"}},
	{"hypotheken", true, []string{"hypothek", "hypo", "neugeschäft", "plan", "volumen"}, card.Spec{
		Question: "Liegt das Hypothekar-Neugeschäft im Plan?", Short: "Hypothekar-Neugeschäft",
		Table: "gold_retail.hypotheken", Measure: "neugeschaeft_chf", Agg: "sum", Vs: "plan_chf",
		Good: &card.Rule{Op: ">=", Vs: true}, Breakdown: "filiale", Display: "trend"}},
	{"zufriedenheit", true, []string{"zufrieden", "zufriedenheit", "feedback", "umfrage", "nps"}, card.Spec{
		Question: "Wie zufrieden sind unsere Kundinnen und Kunden?", Short: "Kundenzufriedenheit",
		Table: "gold_retail.kundenfeedback", Measure: "zufriedenheit_score", Agg: "avg",
		Good: &card.Rule{Op: ">=", Value: num(7.5)}, Breakdown: "filiale", Display: "trend"}},
	{"wartezeit", true, []string{"warte", "wartezeit", "schalter", "warten"}, card.Spec{
		Question: "Wie lange warten Kunden am Schalter?", Short: "Wartezeit am Schalter",
		Table: "gold_retail.schalter", Measure: "wartezeit_min", Agg: "avg",
		Good: &card.Rule{Op: "<=", Value: num(6)}, Breakdown: "filiale", Display: "trend"}},
	{"marketing", false, []string{"marketing", "marketingkosten", "kampagne", "sponsoring", "werbung"}, card.Spec{
		Question: "Sind die Marketingkosten im Budget?", Short: "Marketingkosten",
		Table: "gold_retail.kosten", Measure: "ist_chf", Agg: "sum",
		Filter: map[string]string{"kostenstelle": "Marketing"}, Vs: "budget_chf",
		Good: &card.Rule{Op: "<=", Vs: true}, Breakdown: "kategorie", Display: "trend"}},
	{"neukunden-filiale", false, []string{"welche filiale", "pro filiale", "filialen", "vergleich", "am meisten"}, card.Spec{
		Question: "Welche Filiale gewinnt am meisten Neukunden?", Short: "Neukunden pro Filiale",
		Table: "gold_retail.neukunden", Measure: "neukunden", Agg: "sum",
		Breakdown: "filiale", Display: "bars"}},
	{"bewilligt", false, []string{"bewilligt", "bewilligen", "genehmigt", "zugesagt"}, card.Spec{
		Question: "Wie viele Kredite bewilligen wir pro Woche?", Short: "Bewilligte Kredite",
		Table: "gold_retail.kreditantraege", Measure: "bewilligt", Agg: "sum",
		Breakdown: "filiale", Display: "trend"}},
	{"kosten-stellen", false, []string{"kostenstelle", "wo kosten", "kosten verteilt", "kostenstellen", "kosten"}, card.Spec{
		Question: "Wo fallen die meisten Kosten an?", Short: "Kosten pro Kostenstelle",
		Table: "gold_retail.kosten", Measure: "ist_chf", Agg: "sum",
		Breakdown: "kostenstelle", Display: "bars"}},
	{"eingang", false, []string{"eingang", "eingegangen", "neue anträge", "nachfrage"}, card.Spec{
		Question: "Wie viele Kreditanträge gehen pro Woche ein?", Short: "Eingang Kreditanträge",
		Table: "gold_retail.kreditantraege", Measure: "eingegangen", Agg: "sum",
		Breakdown: "filiale", Display: "trend"}},
}

// clone copies a spec so callers can change it without touching the library.
func clone(s card.Spec) card.Spec {
	if s.Filter != nil {
		f := make(map[string]string, len(s.Filter))
		for k, v := range s.Filter {
			f[k] = v
		}
		s.Filter = f
	}
	if s.Good != nil {
		g := *s.Good
		if g.Value != nil {
			v := *g.Value
			g.Value = &v
		}
		s.Good = &g
	}
	return s
}

func StartBoard() []card.Spec {
	var out []card.Spec
	for _, e := range library {
		if e.Start {
			out = append(out, clone(e.Spec))
		}
	}
	return out
}

// Suggestions returns library questions that are not on the board yet.
func Suggestions(onBoard []card.Card, n int) []card.Spec {
	seen := map[string]bool{}
	for _, c := range onBoard {
		seen[c.Spec.Question] = true
	}
	var out []card.Spec
	for _, e := range library {
		if !seen[e.Spec.Question] && len(out) < n {
			out = append(out, clone(e.Spec))
		}
	}
	return out
}
