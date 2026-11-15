package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// DefaultOpenAIURL is where an openai provider without an address goes.
const DefaultOpenAIURL = "https://api.openai.com/v1"

// OpenAI is Lumina backed by any server with OpenAI's chat completions: OpenAI,
// Azure OpenAI, Ollama, LM Studio, vLLM, Mistral, LiteLLM or a company gateway.
// It speaks plain HTTP and JSON, so it needs no SDK of its own. Servers differ
// in what they take; it finds out on the first request and keeps that.
type OpenAI struct {
	client *http.Client
	url    string // the chat completions endpoint, with its query (Azure's api-version)
	host   string // for messages: api.openai.com, localhost:11434 …
	model  string
	token  string
	azure  bool // Azure takes its key in the api-key header
	// How the server takes the shape of an answer and a token limit (the consts below).
	format, limit atomic.Int32
}

// The shapes of an answer, from the best a server may know to what every model can do.
const (
	shapeSchema int32 = iota // response_format json_schema, strict: the server holds the model to it
	shapeObject              // response_format json_object: valid JSON, the prompt says which
	shapePrompt              // only the prompt; Parse finds the JSON in the text
)

// The ways to cap an answer: OpenAI and Azure want max_completion_tokens (their
// newer models refuse max_tokens), Ollama, LM Studio and Mistral know max_tokens
// (Ollama drops the other without a word), and a few servers take neither.
const (
	limitCompletion int32 = iota
	limitTokens
	limitNone
)

// NewOpenAI builds the client. An address without a path gets /v1, the path of
// nearly every such server; a full address to /chat/completions is kept.
func NewOpenAI(s Settings) *OpenAI {
	base := strings.TrimSpace(s.BaseURL)
	if base == "" {
		base = DefaultOpenAIURL
	}
	o := &OpenAI{client: &http.Client{}, url: base, model: s.Model, token: s.Token}
	if u, err := url.Parse(base); err == nil {
		u.Path = strings.TrimRight(u.Path, "/")
		if u.Path == "" {
			u.Path = "/v1"
		}
		if !strings.HasSuffix(u.Path, "/chat/completions") {
			u.Path += "/chat/completions"
		}
		o.url, o.host, o.azure = u.String(), u.Host, isAzure(u.Hostname())
	}
	if !o.azure && o.host != "api.openai.com" {
		o.limit.Store(limitTokens)
	}
	return o
}

// isAzure says whether a host is Azure OpenAI or Azure AI Foundry.
func isAzure(host string) bool {
	host = strings.ToLower(host)
	for _, s := range []string{".openai.azure.com", ".cognitiveservices.azure.com", ".services.ai.azure.com"} {
		if strings.HasSuffix(host, s) {
			return true
		}
	}
	return false
}

func (o *OpenAI) Model() string { return o.model }

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model               string        `json:"model"`
	Messages            []chatMessage `json:"messages"`
	ResponseFormat      any           `json:"response_format,omitempty"`
	MaxCompletionTokens int           `json:"max_completion_tokens,omitempty"`
	MaxTokens           int           `json:"max_tokens,omitempty"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
			Refusal string `json:"refusal"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
}

// apiError is an answer of the server that is not 200, with what its body says.
type apiError struct {
	Status              int
	Message, Code, Type string
	Param               string
}

func (e *apiError) Error() string { return fmt.Sprintf("%d %s %s", e.Status, e.Code, e.Message) }

// mentions says whether the error is about one of these words, in its message, code or parameter.
func (e *apiError) mentions(words ...string) bool {
	all := strings.ToLower(e.Message + " " + e.Code + " " + e.Type + " " + e.Param)
	for _, w := range words {
		if strings.Contains(all, w) {
			return true
		}
	}
	return false
}

// spent says whether a 429 means money or a quota is used up rather than a busy
// moment (insufficient_quota, credit_balance_exhausted, *_spend_limit_exceeded …).
func (e *apiError) spent() bool {
	return e.mentions("quota", "credit", "spend_limit", "usage_limit", "billing")
}

// readError reads the error a server sends: OpenAI's {"error":{...}}, a plain
// {"error":"..."}, vLLM's {"message":...} or FastAPI's {"detail":...}.
func readError(status int, body []byte) *apiError {
	e := &apiError{Status: status}
	var v struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
		Detail  json.RawMessage `json:"detail"`
	}
	if json.Unmarshal(body, &v) == nil {
		var obj struct {
			Message string          `json:"message"`
			Type    string          `json:"type"`
			Param   string          `json:"param"`
			Code    json.RawMessage `json:"code"`
		}
		var str string
		switch {
		case json.Unmarshal(v.Error, &obj) == nil && obj.Message != "":
			e.Message, e.Type, e.Param = obj.Message, obj.Type, obj.Param
			if err := json.Unmarshal(obj.Code, &e.Code); err != nil {
				e.Code = strings.Trim(string(obj.Code), `"`)
				if e.Code == "null" {
					e.Code = ""
				}
			}
		case json.Unmarshal(v.Error, &str) == nil && str != "":
			e.Message = str
		case v.Message != "":
			e.Message = v.Message
		case len(v.Detail) > 0:
			if json.Unmarshal(v.Detail, &str) != nil {
				str = string(v.Detail)
			}
			e.Message = str
		}
	}
	if e.Message == "" {
		e.Message = strings.TrimSpace(string(body))
	}
	if r := []rune(e.Message); len(r) > 300 {
		e.Message = string(r[:300]) + " …"
	}
	return e
}

// complete sends one conversation and returns the text of the first answer and
// why it ended. With a schema it asks for that shape, as well as the server can
// take it. A server that refuses a shape or a token limit is asked again
// without it, and the client keeps what worked.
func (o *OpenAI) complete(ctx context.Context, msgs []chatMessage, schema map[string]any, maxTokens int) (string, string, error) {
	swapped := false // the limit was tried the other way once; next it goes
	for range 5 {
		req := chatRequest{Model: o.model, Messages: msgs}
		format, limit := o.format.Load(), o.limit.Load()
		if schema != nil {
			switch format {
			case shapeSchema:
				req.ResponseFormat = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "lumina_answer", "strict": true, "schema": schema}}
			case shapeObject:
				req.ResponseFormat = map[string]any{"type": "json_object"}
			}
		}
		switch limit {
		case limitCompletion:
			req.MaxCompletionTokens = maxTokens
		case limitTokens:
			req.MaxTokens = maxTokens
		}
		resp, err := o.send(ctx, req)
		var e *apiError
		if errors.As(err, &e) && (e.Status == 400 || e.Status == 422) {
			switch {
			case req.ResponseFormat != nil && e.mentions("response_format", "response format", "json_schema", "json_object", "structured output"):
				o.format.CompareAndSwap(format, format+1)
				continue
			case limit != limitNone && e.mentions("max_tokens", "max_completion_tokens"):
				// Refused, or too large for the model: once the other name, then no cap.
				next := limitNone
				if !swapped && limit == limitCompletion {
					next = limitTokens
				} else if !swapped {
					next = limitCompletion
				}
				swapped = true
				o.limit.CompareAndSwap(limit, next)
				continue
			}
		}
		if err != nil {
			return "", "", err
		}
		if len(resp.Choices) == 0 {
			return "", "", errors.New("Lumina hat keine Antwort geschrieben.")
		}
		c := resp.Choices[0]
		if c.Message.Refusal != "" {
			return "", "content_filter", nil
		}
		return c.Message.Content, c.FinishReason, nil
	}
	return "", "", errors.New("Der KI-Server nimmt die Anfrage in keiner Form an.")
}

// send posts one request. A busy server (429 without an exhausted quota, 5xx)
// gets two more tries, after the pause it asks for, at most a few seconds.
func (o *OpenAI) send(ctx context.Context, req chatRequest) (*chatResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	for try := 0; ; try++ {
		r, err := http.NewRequestWithContext(ctx, "POST", o.url, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "application/json")
		if o.token != "" {
			if o.azure {
				r.Header.Set("api-key", o.token)
			} else {
				r.Header.Set("Authorization", "Bearer "+o.token)
			}
		}
		res, err := o.client.Do(r)
		if err != nil {
			return nil, err
		}
		raw, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
		res.Body.Close()
		if err != nil {
			return nil, err
		}
		if res.StatusCode == 200 {
			var out chatResponse
			if err := json.Unmarshal(raw, &out); err != nil {
				return nil, fmt.Errorf("Lumina hat unlesbar geantwortet: %v", err)
			}
			return &out, nil
		}
		e := readError(res.StatusCode, raw)
		busy := (e.Status == 429 && !e.spent()) || e.Status == 408 || e.Status >= 500
		if !busy || try == 2 {
			return nil, e
		}
		wait := time.Duration(try+1) * 700 * time.Millisecond
		if s, err := strconv.Atoi(res.Header.Get("Retry-After")); err == nil && s >= 0 {
			wait = min(time.Duration(s)*time.Second, 5*time.Second)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
	}
}

// promptOpenAI is the system prompt with the shape of the answer written out:
// a server without a schema only knows it from here.
var promptOpenAI = func() string {
	shape, _ := json.Marshal(schema())
	return system + "\n\nAntworte nur mit einem JSON-Objekt nach diesem Schema, ohne Text davor oder danach:\n" + string(shape)
}()

func (o *OpenAI) Ask(ctx context.Context, q Question) (*Answer, error) {
	start := time.Now()
	text, finish, err := o.complete(ctx, []chatMessage{{Role: "system", Content: promptOpenAI}, {Role: "user", Content: userText(q)}}, schema(), 8000)
	if err != nil {
		return nil, o.explain(ctx, err)
	}
	if finish == "content_filter" {
		return nil, &NoFit{Msg: "Diese Frage kann Lumina nicht beantworten."}
	}
	ans, err := Parse(text, q)
	var nf *NoFit
	switch {
	case errors.As(err, &nf):
		return nil, err
	case err != nil && finish == "length":
		return nil, errors.New("Lumina hat zu lange nachgedacht und keine Antwort fertig bekommen. Versuch es kürzer.")
	case err != nil && o.format.Load() == shapePrompt && !strings.Contains(text, "{") && strings.TrimSpace(thinkRe.ReplaceAllString(text, "")) != "":
		// A model held to nothing that answered in plain words: the words are the answer, without blocks.
		ans, err = &Answer{Answer: strings.TrimSpace(thinkRe.ReplaceAllString(text, "")), Blocks: []Block{}}, nil
	}
	if err != nil {
		return nil, err
	}
	ans.Model = o.model
	ans.Ms = time.Since(start).Milliseconds()
	return ans, nil
}

// Test sends one tiny request to check address, token and model. Any answer
// counts; a thinking model may use the few tokens up before it writes.
func (o *OpenAI) Test(ctx context.Context) error {
	if o.model == "" {
		return errors.New("Es fehlt das Modell. Trag es unter Einstellungen › Lumina ein.")
	}
	_, _, err := o.complete(ctx, []chatMessage{{Role: "user", Content: "Antworte nur mit OK."}}, nil, 32)
	if err != nil {
		return o.explain(ctx, err)
	}
	return nil
}

// explain turns an error of the server into a sentence for people.
func (o *OpenAI) explain(ctx context.Context, err error) error {
	if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
		return errors.New("Lumina hat zu lange gebraucht. Versuch es nochmals.")
	}
	var e *apiError
	if errors.As(err, &e) {
		switch code := e.Status; {
		case (code == 401 || code == 403) && o.token == "":
			return fmt.Errorf("Der KI-Server %s verlangt ein API-Token (%d). Trag es unter Einstellungen › Lumina ein.", o.host, code)
		case code == 401 || code == 403:
			return fmt.Errorf("Der API-Token wird nicht akzeptiert (%d). Prüf ihn unter Einstellungen › Lumina.", code)
		case code == 404 && e.mentions("model", "deployment"):
			return fmt.Errorf("Das Modell %q kennt der KI-Server %s nicht (404). Prüf den Namen unter Einstellungen › Lumina.", o.model, o.host)
		case code == 404:
			return errors.New("Modell oder Adresse nicht gefunden (404). Prüf Modell und Adresse unter Einstellungen › Lumina.")
		case code == 429 && e.spent():
			return fmt.Errorf("Beim KI-Server %s ist das Kontingent aufgebraucht (429). Prüf Guthaben und Limits beim Anbieter.", o.host)
		case code == 429:
			return errors.New("Lumina ist gerade ausgelastet (429). Versuch es in einem Moment nochmals.")
		case code == 400 || code == 422:
			return fmt.Errorf("Der KI-Server %s hat die Anfrage abgelehnt (%d): %s", o.host, code, e.Message)
		case code >= 500:
			return fmt.Errorf("Der KI-Server %s ist gerade nicht erreichbar (%d). Versuch es später nochmals.", o.host, code)
		}
		return fmt.Errorf("Der KI-Server %s antwortet mit Fehler %d.", o.host, e.Status)
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		return fmt.Errorf("Lumina erreicht den KI-Server %s nicht. Prüf die Adresse unter Einstellungen › Lumina und ob der Server läuft.", o.host)
	}
	return err
}
