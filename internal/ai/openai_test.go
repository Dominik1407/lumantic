package ai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeServer answers chat completions the way a test wants and keeps every request it got.
type fakeServer struct {
	*httptest.Server
	mu      sync.Mutex
	got     []map[string]any
	headers []http.Header
	paths   []string
}

func newFake(t *testing.T, answer func(n int, req map[string]any) (int, string)) *fakeServer {
	t.Helper()
	f := &fakeServer{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req map[string]any
		json.Unmarshal(raw, &req)
		f.mu.Lock()
		f.got = append(f.got, req)
		f.headers = append(f.headers, r.Header.Clone())
		f.paths = append(f.paths, r.URL.RequestURI())
		n := len(f.got)
		f.mu.Unlock()
		status, body := answer(n, req)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "0")
		w.WriteHeader(status)
		io.WriteString(w, body)
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeServer) requests() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.got) }

// reply is a chat completion with this content.
func completion(content, finish string) string {
	b, _ := json.Marshal(map[string]any{"id": "x", "object": "chat.completion", "choices": []any{
		map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": content}, "finish_reason": finish}}})
	return string(b)
}

const good = `{"fits":true,"answer":"Die LCR sinkt seit neun Monaten.","blocks":[{"figure":"lcr","view":"drivers","month":""},{"figure":"cet1","view":"trend","month":""}]}`

func format(req map[string]any) string {
	rf, _ := req["response_format"].(map[string]any)
	if rf == nil {
		return ""
	}
	return rf["type"].(string)
}

func TestOpenAIAsksWithTheSchema(t *testing.T) {
	f := newFake(t, func(int, map[string]any) (int, string) { return 200, completion(good, "stop") })
	o := NewOpenAI(Settings{Provider: "openai", Model: "llama3.1:8b", BaseURL: f.URL + "/v1", Token: "sk-test"})
	a, err := o.Ask(context.Background(), question())
	if err != nil {
		t.Fatal(err)
	}
	if a.Answer != "Die LCR sinkt seit neun Monaten." || len(a.Blocks) != 1 || a.Blocks[0].Figure != "lcr" || a.Model != "llama3.1:8b" {
		t.Fatalf("%+v", a)
	}
	req, h := f.got[0], f.headers[0]
	if f.paths[0] != "/v1/chat/completions" || h.Get("Authorization") != "Bearer sk-test" || h.Get("api-key") != "" || req["model"] != "llama3.1:8b" {
		t.Fatalf("%s %v %v", f.paths[0], h, req["model"])
	}
	js := req["response_format"].(map[string]any)["json_schema"].(map[string]any)
	if format(req) != "json_schema" || js["strict"] != true || js["schema"].(map[string]any)["additionalProperties"] != false {
		t.Fatalf("response_format %v", req["response_format"])
	}
	// Away from OpenAI and Azure the cap is max_tokens, which Ollama and LM Studio read.
	if req["max_tokens"] != float64(8000) || req["max_completion_tokens"] != nil || req["temperature"] != nil {
		t.Fatalf("limits %v %v", req["max_tokens"], req["max_completion_tokens"])
	}
	msgs := req["messages"].([]any)
	sys, user := msgs[0].(map[string]any), msgs[1].(map[string]any)
	if sys["role"] != "system" || !strings.Contains(sys["content"].(string), `"fits"`) || !strings.Contains(user["content"].(string), "Frage: Warum sinkt die LCR?") {
		t.Fatalf("messages %v", msgs)
	}
}

func TestOpenAIStepsDownToWhatTheServerTakes(t *testing.T) {
	// OpenAI's answer for a model without structured outputs, then a plain JSON object.
	f := newFake(t, func(n int, req map[string]any) (int, string) {
		if format(req) == "json_schema" {
			return 400, `{"error":{"message":"Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.","type":"invalid_request_error","param":"response_format","code":null}}`
		}
		return 200, completion(good, "stop")
	})
	o := NewOpenAI(Settings{Model: "gpt-3.5-turbo", BaseURL: f.URL, Token: "sk-test"})
	for range 2 {
		if _, err := o.Ask(context.Background(), question()); err != nil {
			t.Fatal(err)
		}
	}
	if f.requests() != 3 || format(f.got[1]) != "json_object" || format(f.got[2]) != "json_object" {
		t.Fatalf("%d requests: %v", f.requests(), f.got)
	}
	if f.paths[0] != "/v1/chat/completions" {
		t.Fatalf("an address without a path gets /v1: %s", f.paths[0])
	}
}

func TestOpenAIWithoutAnyFormat(t *testing.T) {
	// LM Studio refuses json_object with a plain string; this one refuses the schema too.
	answer := "<think>Die Frage ist zur LCR.</think>\nHier ist die Antwort:\n```json\n" + good + "\n```"
	f := newFake(t, func(n int, req map[string]any) (int, string) {
		switch format(req) {
		case "json_schema":
			return 400, `{"error":"'response_format.json_schema' is not supported"}`
		case "json_object":
			return 400, `{"error":"'response_format.type' must be 'json_schema' or 'text'"}`
		}
		return 200, completion(answer, "stop")
	})
	o := NewOpenAI(Settings{Model: "qwen3", BaseURL: f.URL + "/v1/"})
	a, err := o.Ask(context.Background(), question())
	if err != nil || a.Answer != "Die LCR sinkt seit neun Monaten." || f.requests() != 3 || format(f.got[2]) != "" {
		t.Fatalf("%+v %v after %d requests", a, err, f.requests())
	}
	if f.headers[0].Get("Authorization") != "" {
		t.Fatal("a token was sent where there is none")
	}
	// A model held to nothing that answers in plain words: the words are the answer.
	answer = "Die LCR liegt bei 118 % und damit unter dem internen Ziel."
	if a, err := o.Ask(context.Background(), question()); err != nil || a.Answer != answer || len(a.Blocks) != 0 {
		t.Fatalf("%+v %v", a, err)
	}
}

func TestOpenAIBrokenAnswers(t *testing.T) {
	content, finish := `{"fits":true,"answer":"Die LCR`, "stop"
	f := newFake(t, func(int, map[string]any) (int, string) { return 200, completion(content, finish) })
	o := NewOpenAI(Settings{Model: "m", BaseURL: f.URL})
	if _, err := o.Ask(context.Background(), question()); err == nil || !strings.Contains(err.Error(), "unlesbar") {
		t.Fatalf("broken JSON: %v", err)
	}
	finish = "length"
	if _, err := o.Ask(context.Background(), question()); err == nil || !strings.Contains(err.Error(), "zu lange nachgedacht") {
		t.Fatalf("cut off: %v", err)
	}
	content, finish = `{"fits":false,"answer":"Dazu gibt es nur Zahlen zu Liquidität und Kapital.","blocks":[]}`, "stop"
	var nf *NoFit
	if _, err := o.Ask(context.Background(), question()); !errors.As(err, &nf) || !strings.Contains(nf.Msg, "Liquidität") {
		t.Fatalf("no fit: %v", err)
	}
	content, finish = "", "content_filter"
	if _, err := o.Ask(context.Background(), question()); !errors.As(err, &nf) {
		t.Fatalf("filtered: %v", err)
	}
	if _, err := NewOpenAI(Settings{Model: "m", BaseURL: newFake(t, func(int, map[string]any) (int, string) { return 200, "<html>" }).URL}).Ask(context.Background(), question()); err == nil || !strings.Contains(err.Error(), "unlesbar") {
		t.Fatalf("no JSON at all: %v", err)
	}
}

func TestOpenAIRefusal(t *testing.T) {
	f := newFake(t, func(int, map[string]any) (int, string) {
		return 200, `{"choices":[{"message":{"role":"assistant","content":null,"refusal":"I can't help with that."},"finish_reason":"stop"}]}`
	})
	var nf *NoFit
	if _, err := NewOpenAI(Settings{Model: "m", BaseURL: f.URL}).Ask(context.Background(), question()); !errors.As(err, &nf) {
		t.Fatalf("%v", err)
	}
}

func TestOpenAIErrorsInWords(t *testing.T) {
	for _, c := range []struct {
		name, token string
		status      int
		body, want  string
		tries       int
	}{
		{"wrong key", "sk-falsch", 401, `{"error":{"message":"Incorrect API key provided.","type":"invalid_request_error","code":"invalid_api_key"}}`, "Der API-Token wird nicht akzeptiert (401)", 1},
		{"no key", "", 401, `{"error":{"message":"You didn't provide an API key.","type":"invalid_request_error"}}`, "verlangt ein API-Token (401)", 1},
		{"unknown model, Ollama", "", 404, `{"error":{"message":"model 'llama9' not found","type":"not_found_error","param":null,"code":null}}`, `Das Modell "llama9" kennt der KI-Server`, 1},
		{"unknown address", "", 404, `404 page not found`, "Modell oder Adresse nicht gefunden (404)", 1},
		{"quota", "sk-x", 429, `{"error":{"message":"You exceeded your current quota.","type":"insufficient_quota","code":"insufficient_quota"}}`, "Kontingent aufgebraucht (429)", 1},
		{"busy", "sk-x", 429, `{"error":{"message":"Rate limit reached","type":"tokens","code":"rate_limit_exceeded"}}`, "ausgelastet (429)", 3},
		{"down", "sk-x", 503, `{"error":{"message":"Service Unavailable"}}`, "gerade nicht erreichbar (503)", 3},
		{"refused", "sk-x", 400, `{"object":"error","message":"This model's maximum context length is 4096 tokens.","type":"BadRequestError","code":400}`, "hat die Anfrage abgelehnt (400): This model's maximum context length is 4096 tokens.", 1},
	} {
		f := newFake(t, func(int, map[string]any) (int, string) { return c.status, c.body })
		o := NewOpenAI(Settings{Model: "llama9", BaseURL: f.URL, Token: c.token})
		err := o.Test(context.Background())
		if err == nil || !strings.Contains(err.Error(), c.want) || f.requests() != c.tries {
			t.Errorf("%s: %v after %d requests", c.name, err, f.requests())
		}
	}
}

func TestOpenAIUnreachableAndSlow(t *testing.T) {
	f := newFake(t, func(int, map[string]any) (int, string) { return 200, completion("OK", "stop") })
	gone := f.URL
	f.Close()
	if err := NewOpenAI(Settings{Model: "m", BaseURL: gone}).Test(context.Background()); err == nil || !strings.Contains(err.Error(), "erreicht den KI-Server 127.0.0.1") {
		t.Fatalf("closed: %v", err)
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(time.Second):
		}
	}))
	defer slow.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := NewOpenAI(Settings{Model: "m", BaseURL: slow.URL}).Test(ctx); err == nil || !strings.Contains(err.Error(), "zu lange gebraucht") {
		t.Fatalf("slow: %v", err)
	}
	if err := NewOpenAI(Settings{BaseURL: slow.URL}).Test(context.Background()); err == nil || !strings.Contains(err.Error(), "Es fehlt das Modell") {
		t.Fatalf("no model: %v", err)
	}
}

func TestOpenAITest(t *testing.T) {
	// A thinking model may spend the few tokens before it writes: still connected.
	f := newFake(t, func(int, map[string]any) (int, string) { return 200, completion("", "length") })
	if err := NewOpenAI(Settings{Model: "gpt-5-mini", BaseURL: f.URL, Token: "sk"}).Test(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.got[0]["response_format"] != nil || f.got[0]["max_tokens"] != float64(32) {
		t.Fatalf("%v", f.got[0])
	}
}

func TestOpenAITokenLimit(t *testing.T) {
	// A server that knows neither name, after OpenAI's own words for the newer models.
	f := newFake(t, func(n int, req map[string]any) (int, string) {
		switch {
		case req["max_completion_tokens"] != nil:
			return 400, `{"error":{"message":"Unrecognized request argument supplied: max_completion_tokens","type":"invalid_request_error","param":"max_completion_tokens","code":"unsupported_parameter"}}`
		case req["max_tokens"] != nil:
			return 400, `{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.","type":"invalid_request_error","param":"max_tokens","code":"unsupported_parameter"}}`
		}
		return 200, completion(good, "stop")
	})
	o := NewOpenAI(Settings{Model: "m", BaseURL: f.URL})
	o.limit.Store(limitCompletion) // as at OpenAI or Azure
	if _, err := o.Ask(context.Background(), question()); err != nil {
		t.Fatal(err)
	}
	if f.requests() != 3 || f.got[1]["max_tokens"] == nil || f.got[2]["max_tokens"] != nil || f.got[2]["max_completion_tokens"] != nil {
		t.Fatalf("%d %v", f.requests(), f.got)
	}
	if _, err := o.Ask(context.Background(), question()); err != nil || f.requests() != 4 {
		t.Fatalf("not kept: %v, %d", err, f.requests())
	}
}

func TestOpenAIAzure(t *testing.T) {
	f := newFake(t, func(int, map[string]any) (int, string) { return 200, completion(good, "stop") })
	// The classic address of a deployment keeps its api-version.
	o := NewOpenAI(Settings{Model: "gpt-4o", BaseURL: f.URL + "/openai/deployments/lumina?api-version=2024-10-21", Token: "azure-key"})
	o.azure = true
	if _, err := o.Ask(context.Background(), question()); err != nil {
		t.Fatal(err)
	}
	if f.paths[0] != "/openai/deployments/lumina/chat/completions?api-version=2024-10-21" || f.headers[0].Get("api-key") != "azure-key" || f.headers[0].Get("Authorization") != "" {
		t.Fatalf("%s %v", f.paths[0], f.headers[0])
	}
}

func TestOpenAIAddresses(t *testing.T) {
	for _, c := range []struct {
		base, url string
		azure     bool
		limit     int32
	}{
		{"", "https://api.openai.com/v1/chat/completions", false, limitCompletion},
		{"http://localhost:11434", "http://localhost:11434/v1/chat/completions", false, limitTokens},
		{"http://localhost:1234/v1/", "http://localhost:1234/v1/chat/completions", false, limitTokens},
		{"https://gateway.example.ch/llm/v1/chat/completions", "https://gateway.example.ch/llm/v1/chat/completions", false, limitTokens},
		{"https://bank.openai.azure.com/openai/v1", "https://bank.openai.azure.com/openai/v1/chat/completions", true, limitCompletion},
		{"https://bank.services.ai.azure.com/openai/v1/", "https://bank.services.ai.azure.com/openai/v1/chat/completions", true, limitCompletion},
	} {
		o := NewOpenAI(Settings{Model: "m", BaseURL: c.base})
		if o.url != c.url || o.azure != c.azure || o.limit.Load() != c.limit {
			t.Errorf("%q: %s azure=%v limit=%d", c.base, o.url, o.azure, o.limit.Load())
		}
	}
	if isAzure("openai.azure.com.example.org") || !isAzure("Bank.OpenAI.Azure.com") {
		t.Fatal("isAzure")
	}
}

func TestJSONOfFindsTheObject(t *testing.T) {
	for _, text := range []string{
		good,
		"```json\n" + good + "\n```",
		"<think>\nhm {\n</think>\n" + good,
		"Gern. " + good + " Sonst noch etwas?",
	} {
		if a, err := Parse(text, question()); err != nil || a.Answer != "Die LCR sinkt seit neun Monaten." {
			t.Errorf("%q: %+v %v", text, a, err)
		}
	}
}
