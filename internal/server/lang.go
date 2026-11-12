package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Dominik1407/lumantic/internal/i18n"
)

// speak answers in English when the interface asks for it: the messages in a
// JSON answer go through the table of internal/i18n on their way out. The
// figures themselves (/api/metrics) carry no messages and are many, so they
// pass as they are, as do the stream of updates and the catalog export, which
// is written in the words of the contract.
func speak(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if !strings.HasPrefix(p, "/api/") || p == "/api/events" || p == "/api/katalog/export" || !i18n.Wants(r) {
			next.ServeHTTP(w, r)
			return
		}
		rec := &recorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		body := rec.buf.Bytes()
		if strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") && !(p == "/api/metrics" && rec.status == 200) {
			body = translated(body)
		}
		w.WriteHeader(rec.status)
		w.Write(body)
	})
}

// recorder keeps an answer until it is translated.
type recorder struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (r *recorder) WriteHeader(code int)        { r.status = code }
func (r *recorder) Write(b []byte) (int, error) { return r.buf.Write(b) }

// translated is a JSON body with every string that is one of Lumantic's
// messages in English; anything it cannot read stays as it was.
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
	if enc.Encode(walk(v)) != nil {
		return body
	}
	return out.Bytes()
}

func walk(v any) any {
	switch t := v.(type) {
	case string:
		return i18n.EN(t)
	case []any:
		for i := range t {
			t[i] = walk(t[i])
		}
	case map[string]any:
		for k := range t {
			t[k] = walk(t[k])
		}
	}
	return v
}
