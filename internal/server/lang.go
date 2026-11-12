package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Dominik1407/lumantic/internal/i18n"
)

// speak answers in English when the interface asks for it: Lumantic's messages
// in a JSON answer go through the table of internal/i18n on their way out. Only
// the fields that carry messages are touched, never what people wrote or the
// data; answers that carry no messages pass as they are.
func speak(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || plain[r.URL.Path] || !i18n.Wants(r) {
			next.ServeHTTP(w, r)
			return
		}
		rec := &recorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		body := rec.buf.Bytes()
		if strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") && !(r.URL.Path == "/api/metrics" && rec.status == 200) {
			body = translated(body)
		}
		w.WriteHeader(rec.status)
		w.Write(body)
	})
}

// plain are the answers without messages: the stream of updates, the catalog
// export (in the words of the contract), the workspace and Lumina's catalog.
var plain = map[string]bool{"/api/events": true, "/api/katalog/export": true, "/api/workspace": true, "/api/catalog": true}

// messages are the fields in which Lumantic writes its messages.
var messages = map[string]bool{"error": true, "problems": true, "note": true, "status": true, "company": true}

// recorder keeps an answer until it is translated.
type recorder struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (r *recorder) WriteHeader(code int)        { r.status = code }
func (r *recorder) Write(b []byte) (int, error) { return r.buf.Write(b) }

// translated is a JSON body with the messages in English; anything it cannot
// read stays as it was.
func translated(body []byte) []byte {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var v any
	if dec.Decode(&v) != nil {
		return body
	}
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	if enc.Encode(walk(v, false)) != nil {
		return body
	}
	return out.Bytes()
}

// walk translates the strings under message fields, at any depth.
func walk(v any, message bool) any {
	switch t := v.(type) {
	case string:
		if message {
			return i18n.EN(t)
		}
	case []any:
		for i := range t {
			t[i] = walk(t[i], message)
		}
	case map[string]any:
		for k := range t {
			t[k] = walk(t[k], messages[k])
		}
	}
	return v
}
