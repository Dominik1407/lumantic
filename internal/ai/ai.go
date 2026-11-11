// Package ai connects Lumina to Claude. It builds the one Anthropic client the
// server uses (token from the secrets file or the environment, an optional
// company gateway as base URL) and answers questions about the month's key
// figures. Lumina sees the figures the app shows, never rows of the gold layer.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

// Settings is what the client needs. AuthToken means Token is a bearer token
// (ANTHROPIC_AUTH_TOKEN) rather than an API key.
type Settings struct {
	Model     string
	BaseURL   string
	Token     string
	AuthToken bool
}

// NewClient builds the Anthropic client for these settings.
func NewClient(s Settings) anthropic.Client {
	opts := []option.RequestOption{option.WithMaxRetries(2)}
	if s.AuthToken {
		opts = append(opts, option.WithAuthToken(s.Token))
	} else {
		opts = append(opts, option.WithAPIKey(s.Token))
	}
	if s.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(s.BaseURL))
	}
	return anthropic.NewClient(opts...)
}

// Views are the chart kinds the app can show for a figure.
var Views = []string{"trend", "cum", "parts", "bridge", "drivers", "funnel", "season", "buffer", "compare", "daily"}

type Part struct {
	Name  string   `json:"name"`
	Value *float64 `json:"value"`
	Prev  *float64 `json:"prev"`
}

// Figure is one key figure as the app shows it for the month.
type Figure struct {
	ID     string     `json:"id"`
	Name   string     `json:"name"`
	Unit   string     `json:"unit"`
	Value  *float64   `json:"value"`
	Prev   *float64   `json:"prev"`
	Target *float64   `json:"target"`
	Limit  *float64   `json:"limit"`
	Level  string     `json:"level"`
	Label  string     `json:"label"`
	Run    int        `json:"run"`
	Driver string     `json:"driver"`
	Last13 []*float64 `json:"last13"`
	Parts  []Part     `json:"parts"`
	// From the catalog, added by the server: what the figure means.
	Definition string `json:"definition,omitempty"`
}

type Facts struct {
	Title   string   `json:"title"`
	Month   string   `json:"month"`
	Figures []Figure `json:"figures"`
}

type Question struct {
	Question string `json:"question"`
	Month    string `json:"month"` // YYYY-MM
	Facts    Facts  `json:"facts"`
	// The words of the business from the catalog, added by the server.
	Words []Word `json:"words,omitempty"`
}

// Word is a term of the business, what it means and what else people call it.
type Word struct {
	Term       string   `json:"term"`
	Definition string   `json:"definition"`
	Synonyms   []string `json:"synonyms,omitempty"`
	Figure     string   `json:"figure,omitempty"` // the id of the figure it names
}

type Block struct {
	Figure string `json:"figure"`
	View   string `json:"view"`
	Month  string `json:"month"`
}

type Answer struct {
	Answer string  `json:"answer"`
	Blocks []Block `json:"blocks"`
	Model  string  `json:"model"`
	Ms     int64   `json:"ms"`
}

// NoFit means the facts do not answer the question; Msg says what is there instead.
type NoFit struct{ Msg string }

func (e *NoFit) Error() string { return e.Msg }

// Lumina answers questions. The server holds one; tests use a fake.
type Lumina interface {
	Model() string
	Ask(ctx context.Context, q Question) (*Answer, error)
	Test(ctx context.Context) error
}

// Claude is Lumina backed by the Anthropic API.
type Claude struct {
	client anthropic.Client
	model  string
}

func NewClaude(s Settings) *Claude { return &Claude{client: NewClient(s), model: s.Model} }

// Client exposes the client so the legacy card translator can share it.
func (c *Claude) Client() anthropic.Client { return c.client }
func (c *Claude) Model() string            { return c.model }

// The system prompt is static so it caches; the facts go into the user turn.
const system = `Du bist Lumina, die Assistentin in Lumantic. Lumantic zeigt einem Management-Team (Bank, Industrie, Handel) die Kennzahlen eines Monats: was Aufmerksamkeit braucht und was ruhig ist. Die Leute kennen sich mit Daten nicht aus und wollen kurze, klare Antworten.

Du bekommst die Kennzahlen des Monats als JSON (Wert, Vormonat, Ziel, Limit, Status, Serie der letzten 13 Monate, Teile, Definition), oft die Begriffe des Teams mit Synonymen, und eine Frage.

Regeln:
- Antworte nur aus diesen Zahlen. Erfinde keine Werte, keine Ursachen und keine Ereignisse.
- Ein Synonym aus den Begriffen meint die Kennzahl dazu: «Termintreue» kann die Liefertreue sein. Fragt jemand, was eine Kennzahl bedeutet, erkläre sie mit ihrer Definition, ohne sie zu erweitern.
- Sag, welcher Teil sich bewegt hat, nie warum. Ursachen kennt das Team, nicht die Daten.
- Antworte in 1 bis 3 kurzen Sätzen auf Deutsch mit Schweizer Schreibweise: ss statt ß, «Guillemets», du-Form. Zahlen wie in der App: 1’150 Mio. CHF, 118 %, Prozentpunkte für Abstände bei Prozenten.
- Wenn die Zahlen die Frage nicht beantworten, setze fits auf false und sag in answer in einem Satz, wozu es Zahlen gibt.
- Schlage höchstens drei Bausteine vor, die die Antwort belegen: figure ist eine id aus den Kennzahlen, view eine dieser Ansichten: trend (Verlauf mit Ziel und Limit), cum (kumuliert im Jahr, für Flüsse), parts (Zusammensetzung), bridge (Brücke vom Vormonat), drivers (Zähler und Nenner einer Quote), funnel (Stufen), season (Saison), buffer (Abstand zum Limit), compare (Vergleich mit einer anderen Kennzahl), daily (Tagesverlauf). month ist "" für den gezeigten Monat oder JJJJ-MM für einen anderen.`

func schema() map[string]any {
	str := map[string]any{"type": "string"}
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"fits", "answer", "blocks"},
		"properties": map[string]any{
			"fits":   map[string]any{"type": "boolean"},
			"answer": str,
			"blocks": map[string]any{"type": "array", "items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"figure", "view", "month"},
				"properties": map[string]any{
					"figure": str,
					"view":   map[string]any{"type": "string", "enum": Views},
					"month":  str,
				},
			}},
		},
	}
}

type reply struct {
	Fits   bool    `json:"fits"`
	Answer string  `json:"answer"`
	Blocks []Block `json:"blocks"`
}

func (c *Claude) Ask(ctx context.Context, q Question) (*Answer, error) {
	facts, _ := json.Marshal(q.Facts)
	user := "Kennzahlen (" + q.Facts.Month + "):\n" + string(facts)
	if len(q.Words) > 0 {
		words, _ := json.Marshal(q.Words)
		user += "\n\nBegriffe:\n" + string(words)
	}
	user += "\n\nFrage: " + q.Question
	start := time.Now()
	resp, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     c.model,
		MaxTokens: 8000,
		Thinking:  anthropic.ThinkingConfigParamUnion{OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{}},
		System: []anthropic.TextBlockParam{{
			Text:         system,
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
		}},
		Messages: []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(user))},
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortMedium,
			Format: anthropic.JSONOutputFormatParam{Schema: schema()},
		},
	})
	if err != nil {
		return nil, Explain(ctx, err)
	}
	if resp.StopReason == anthropic.StopReasonRefusal {
		return nil, &NoFit{Msg: "Diese Frage kann Lumina nicht beantworten."}
	}
	if resp.StopReason == anthropic.StopReasonMaxTokens {
		return nil, errors.New("Lumina hat zu lange nachgedacht und keine Antwort fertig bekommen. Versuch es kürzer.")
	}
	var text strings.Builder
	for _, block := range resp.Content {
		if b, ok := block.AsAny().(anthropic.TextBlock); ok {
			text.WriteString(b.Text)
		}
	}
	ans, err := Parse(text.String(), q)
	if err != nil {
		return nil, err
	}
	ans.Model = c.model
	ans.Ms = time.Since(start).Milliseconds()
	return ans, nil
}

// Test sends one tiny request to check token, model and address.
func (c *Claude) Test(ctx context.Context) error {
	_, err := c.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:        c.model,
		MaxTokens:    64,
		Messages:     []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("Antworte nur mit OK."))},
		OutputConfig: anthropic.OutputConfigParam{Effort: anthropic.OutputConfigEffortLow},
	})
	if err != nil {
		return Explain(ctx, err)
	}
	return nil
}

var monthRe = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)

// Parse reads Claude's JSON reply and keeps only blocks the app can show.
func Parse(text string, q Question) (*Answer, error) {
	var r reply
	if err := json.Unmarshal([]byte(strings.TrimSpace(text)), &r); err != nil {
		return nil, fmt.Errorf("Lumina hat unlesbar geantwortet: %v", err)
	}
	r.Answer = strings.TrimSpace(r.Answer)
	if !r.Fits {
		msg := r.Answer
		if msg == "" {
			msg = "Dazu gibt es in den Kennzahlen dieses Monats keine Antwort."
		}
		return nil, &NoFit{Msg: msg}
	}
	if r.Answer == "" {
		return nil, errors.New("Lumina hat keine Antwort geschrieben.")
	}
	ids := map[string]bool{}
	for _, f := range q.Facts.Figures {
		ids[f.ID] = true
	}
	views := map[string]bool{}
	for _, v := range Views {
		views[v] = true
	}
	ans := &Answer{Answer: r.Answer, Blocks: []Block{}}
	seen := map[string]bool{}
	for _, b := range r.Blocks {
		b.Month = strings.TrimSpace(b.Month)
		key := b.Figure + "|" + b.View + "|" + b.Month
		if !ids[b.Figure] || !views[b.View] || (b.Month != "" && !monthRe.MatchString(b.Month)) || seen[key] {
			continue
		}
		seen[key] = true
		ans.Blocks = append(ans.Blocks, b)
		if len(ans.Blocks) == 3 {
			break
		}
	}
	return ans, nil
}

// Explain turns an API error into a sentence for people.
func Explain(ctx context.Context, err error) error {
	if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
		return errors.New("Lumina hat zu lange gebraucht. Versuch es nochmals.")
	}
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		switch code := apiErr.StatusCode; {
		case code == 401 || code == 403:
			return fmt.Errorf("Der API-Token wird nicht akzeptiert (%d). Prüf ihn unter Einstellungen › Lumina.", code)
		case code == 404:
			return errors.New("Modell oder Adresse nicht gefunden (404). Prüf Modell und Adresse unter Einstellungen › Lumina.")
		case code == 400:
			return fmt.Errorf("Anthropic hat die Anfrage abgelehnt (400): %s", apiErr.Message)
		case code == 429:
			return errors.New("Lumina ist gerade ausgelastet (429). Versuch es in einem Moment nochmals.")
		case code >= 500:
			return fmt.Errorf("Anthropic ist gerade nicht erreichbar (%d). Versuch es später nochmals.", code)
		}
		return fmt.Errorf("Anthropic antwortet mit Fehler %d.", apiErr.StatusCode)
	}
	return fmt.Errorf("Lumina erreicht Anthropic nicht: %v", err)
}
