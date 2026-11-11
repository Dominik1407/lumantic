// Package lumina turns plain-language questions and briefings into card
// specs. Lumina only ever sees the catalog (structure and category names),
// never data rows, and it never writes SQL: it fills in a Spec that the
// card package validates and compiles.
package lumina

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"

	"github.com/Dominik1407/lumantic/internal/card"
	"github.com/Dominik1407/lumantic/internal/catalog"
)

type Translator interface {
	Mode() string // "claude" or "beispiel"
	Model() string
	Ask(ctx context.Context, cat *catalog.Catalog, question string) ([]card.Spec, error)
	Brief(ctx context.Context, cat *catalog.Catalog, about string) ([]card.Spec, error)
}

// NoAnswer means the question does not fit the gold layer. Msg is for people.
type NoAnswer struct{ Msg string }

func (e *NoAnswer) Error() string { return e.Msg }

// ---- Claude ----

type Claude struct {
	client anthropic.Client
	model  string
}

// NewClaude uses the client the server builds from its settings (see internal/ai).
func NewClaude(client anthropic.Client, model string) *Claude {
	return &Claude{client: client, model: model}
}

func (c *Claude) Mode() string  { return "claude" }
func (c *Claude) Model() string { return c.model }

const instructions = `Du bist Lumina, die KI in Lumantic. Lumantic ist eine ruhige Oberfläche über dem Goldlayer eines Teams: Menschen ohne Datenkenntnisse stellen Fragen, und jede Frage wird zu einer Karte mit einer festen, nachvollziehbaren Berechnung.

Deine Aufgabe: Übersetze die Frage (oder das Briefing) in Kartendefinitionen für den unten beschriebenen Katalog. Du siehst nur die Struktur des Goldlayers, keine Datenzeilen. Du schreibst kein SQL; Lumantic prüft deine Definition gegen den Katalog und rechnet selbst.

Regeln für jede Karte:
- table, measure, vs, breakdown und filters[].column müssen exakt so im Katalog stehen. filters[].value muss einer der gelisteten values der Spalte sein.
- measure ist eine Spalte mit role "measure". agg ist "avg" für Durchschnitte, Bewertungen (Einheit "von 10") und Minuten, sonst "sum".
- vs setzt du nur, wenn die Frage mit Budget oder Plan vergleicht und die Tabelle dafür eine Spalte hat. Sonst "".
- good beschreibt, was gut ist. Fragt jemand, ob etwas im Budget oder im Plan liegt: good_op "<=" (Kosten) oder ">=" (Ertrag, Volumen) mit good_vs true. Nennt jemand einen Zielwert ("gut ist, wenn mindestens 140", "höchstens 40 offen"): good_op mit good_value und good_vs false. Ohne erkennbares Ziel: good_op "none", good_value 0, good_vs false.
- display "bars" nur, wenn verglichen wird, welche Gruppe vorne liegt ("welche Filiale", "pro Kostenstelle"); dann ist breakdown diese Dimension. Sonst "trend" und breakdown die Dimension, die Abweichungen am besten erklärt, oder "".
- question ist die Frage, wie sie auf der Karte steht: kurz, klar, Deutsch mit Schweizer Schreibweise (ss statt ß). short ist eine Bezeichnung mit 1 bis 3 Wörtern, z. B. "IT-Kosten".

Passt die Frage nicht zu den Daten, setze ok auf false, cards auf [] und erkläre in message in einem Satz, was fehlt und wozu es Daten gibt. Sonst ok true und message "".`

func cardSchema() map[string]any {
	str := map[string]any{"type": "string"}
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"question", "short", "table", "measure", "agg", "filters", "vs", "good_op", "good_value", "good_vs", "breakdown", "display"},
		"properties": map[string]any{
			"question": str, "short": str, "table": str, "measure": str, "vs": str, "breakdown": str,
			"agg": map[string]any{"type": "string", "enum": []string{"sum", "avg"}},
			"filters": map[string]any{"type": "array", "items": map[string]any{
				"type": "object", "additionalProperties": false, "required": []string{"column", "value"},
				"properties": map[string]any{"column": str, "value": str},
			}},
			"good_op":    map[string]any{"type": "string", "enum": []string{"none", "<=", ">="}},
			"good_value": map[string]any{"type": "number"},
			"good_vs":    map[string]any{"type": "boolean"},
			"display":    map[string]any{"type": "string", "enum": []string{"trend", "bars"}},
		},
	}
}

func replySchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"ok", "message", "cards"},
		"properties": map[string]any{
			"ok":      map[string]any{"type": "boolean"},
			"message": map[string]any{"type": "string"},
			"cards":   map[string]any{"type": "array", "items": cardSchema()},
		},
	}
}

type replyCard struct {
	Question string `json:"question"`
	Short    string `json:"short"`
	Table    string `json:"table"`
	Measure  string `json:"measure"`
	Agg      string `json:"agg"`
	Filters  []struct {
		Column string `json:"column"`
		Value  string `json:"value"`
	} `json:"filters"`
	Vs        string  `json:"vs"`
	GoodOp    string  `json:"good_op"`
	GoodValue float64 `json:"good_value"`
	GoodVs    bool    `json:"good_vs"`
	Breakdown string  `json:"breakdown"`
	Display   string  `json:"display"`
}

type reply struct {
	OK      bool        `json:"ok"`
	Message string      `json:"message"`
	Cards   []replyCard `json:"cards"`
}

func (rc replyCard) spec() card.Spec {
	s := card.Spec{Question: rc.Question, Short: rc.Short, Table: rc.Table, Measure: rc.Measure, Agg: rc.Agg,
		Vs: rc.Vs, Breakdown: rc.Breakdown, Display: rc.Display}
	if len(rc.Filters) > 0 {
		s.Filter = map[string]string{}
		for _, f := range rc.Filters {
			s.Filter[f.Column] = f.Value
		}
	}
	if rc.GoodOp == "<=" || rc.GoodOp == ">=" {
		s.Good = &card.Rule{Op: rc.GoodOp, Vs: rc.GoodVs}
		if !rc.GoodVs {
			v := rc.GoodValue
			s.Good.Value = &v
		}
	}
	return s
}

func (c *Claude) call(ctx context.Context, cat *catalog.Catalog, task string) ([]card.Spec, error) {
	catJSON, _ := json.Marshal(cat)
	resp, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     c.model,
		MaxTokens: 16000,
		System: []anthropic.TextBlockParam{{
			Text:         instructions + "\n\nKatalog:\n" + string(catJSON),
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
		}},
		Messages: []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(task))},
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{Schema: replySchema()},
		},
	},
		// If a safety classifier declines, the API re-runs the request on a suitable fallback model.
		option.WithHeaderAdd("anthropic-beta", "server-side-fallback-2026-07-01"),
		option.WithJSONSet("fallbacks", "default"),
	)
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) {
			switch apiErr.StatusCode {
			case 401, 403:
				return nil, fmt.Errorf("Lumina hat keinen gültigen Claude-Zugang (%d)", apiErr.StatusCode)
			case 429:
				return nil, errors.New("Lumina ist gerade ausgelastet. Versuch es in einem Moment nochmals.")
			}
		}
		return nil, fmt.Errorf("Lumina ist nicht erreichbar: %w", err)
	}
	if resp.StopReason == anthropic.StopReasonRefusal {
		return nil, &NoAnswer{Msg: "Diese Frage kann Lumina nicht beantworten."}
	}
	var text strings.Builder
	for _, block := range resp.Content {
		if b, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(b.Text)
		}
	}
	var r reply
	if err := json.Unmarshal([]byte(text.String()), &r); err != nil {
		return nil, fmt.Errorf("Lumina hat unlesbar geantwortet: %w", err)
	}
	if !r.OK || len(r.Cards) == 0 {
		msg := r.Message
		if msg == "" {
			msg = "Dazu gibt es im Goldlayer keine passenden Daten."
		}
		return nil, &NoAnswer{Msg: msg}
	}
	specs := make([]card.Spec, len(r.Cards))
	for i, rc := range r.Cards {
		specs[i] = rc.spec()
	}
	return specs, nil
}

func (c *Claude) Ask(ctx context.Context, cat *catalog.Catalog, question string) ([]card.Spec, error) {
	return c.call(ctx, cat, "Erstelle genau eine Karte für diese Frage:\n\n"+question)
}

func (c *Claude) Brief(ctx context.Context, cat *catalog.Catalog, about string) ([]card.Spec, error) {
	return c.call(ctx, cat, "Eine Person beschreibt ihre Rolle und was sie interessiert. Schlage 3 bis 6 Karten vor, die sie jede Woche wirklich braucht, mit sinnvollen Regeln dafür, was gut ist:\n\n"+about)
}

// ---- Beispielmodus ----

// Offline matches questions against the library. It keeps the demo usable
// without Claude credentials and never invents anything.
type Offline struct{}

func (Offline) Mode() string  { return "beispiel" }
func (Offline) Model() string { return "" }

var wordRe = regexp.MustCompile(`[\p{L}]+`)

func score(text string, e entry) int {
	words := map[string]bool{}
	for _, w := range wordRe.FindAllString(text, -1) {
		words[w] = true
	}
	n := 0
	for _, k := range e.Keywords {
		if (len(k) <= 3 && words[k]) || (len(k) > 3 && strings.Contains(text, k)) {
			n += len(k)
		}
	}
	return n
}

func (Offline) Ask(ctx context.Context, cat *catalog.Catalog, question string) ([]card.Spec, error) {
	q := strings.ToLower(question)
	best, bestScore := -1, 0
	for i, e := range library {
		if s := score(q, e); s > bestScore {
			best, bestScore = i, s
		}
	}
	if best < 0 {
		return nil, &NoAnswer{Msg: "Im Beispielmodus versteht Lumina nur Fragen zu Kosten, Krediten, Neukunden, Hypotheken, Zufriedenheit und Wartezeit. Für freie Fragen braucht Lumantic einen Claude-Zugang."}
	}
	spec := clone(library[best].Spec)
	applyTarget(&spec, q)
	return []card.Spec{spec}, nil
}

func (Offline) Brief(ctx context.Context, cat *catalog.Catalog, about string) ([]card.Spec, error) {
	a := strings.ToLower(about)
	var out []card.Spec
	for _, e := range library {
		if score(a, e) > 0 {
			out = append(out, clone(e.Spec))
		}
	}
	if len(out) == 0 {
		out = StartBoard()
	}
	return out, nil
}

var targetRe = regexp.MustCompile(`(mindestens|minimum|mehr als|über|ab|höchstens|maximal|maximum|weniger als|unter|max\.?|min\.?)\s*([0-9][0-9’'.,]*)`)

// applyTarget reads phrases like "gut ist mehr als 140" into the card's rule.
func applyTarget(s *card.Spec, q string) {
	m := targetRe.FindStringSubmatch(q)
	if m == nil {
		return
	}
	raw := strings.NewReplacer("’", "", "'", "", ",", ".").Replace(m[2])
	v, err := strconv.ParseFloat(strings.TrimRight(raw, "."), 64)
	if err != nil {
		return
	}
	op := "<="
	switch m[1] {
	case "mindestens", "minimum", "mehr als", "über", "ab", "min", "min.":
		op = ">="
	}
	s.Good = &card.Rule{Op: op, Value: &v}
}
