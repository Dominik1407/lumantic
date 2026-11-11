package server

import (
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/Dominik1407/lumantic/internal/config"
)

// guard protects the changing endpoints from other websites: the server runs
// on the person's machine, and any page in their browser could otherwise send
// it requests. Browsers mark cross-site requests (Sec-Fetch-Site, Origin);
// those are refused. A request with a body must declare JSON, which a foreign
// page cannot send without a preflight this server never grants.
func guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/") || r.Method == http.MethodGet || r.Method == http.MethodHead {
			next.ServeHTTP(w, r)
			return
		}
		if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
			fail(w, 403, "Anfragen von anderen Websites sind nicht erlaubt.")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || origin == "null" || !strings.EqualFold(u.Host, r.Host) {
				fail(w, 403, "Anfragen von anderen Websites sind nicht erlaubt.")
				return
			}
		}
		// A loading job that says "new data" may send a webhook body of any kind;
		// /api/refresh reads only its token and ignores the body.
		if r.URL.Path == "/api/refresh" && r.Header.Get("Authorization") != "" {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
			next.ServeHTTP(w, r)
			return
		}
		if hasBody(r) {
			ct, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if ct != "application/json" {
				fail(w, 415, "Bitte als JSON senden (Content-Type: application/json).")
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		next.ServeHTTP(w, r)
	})
}

func hasBody(r *http.Request) bool {
	return r.ContentLength > 0 || (r.ContentLength < 0 && r.Body != nil && r.Body != http.NoBody)
}

// brandFile serves fonts and logos from config/brand/: only known file types,
// no folders, nothing outside.
func (s *Server) brandFile(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/brand/")
	ext := strings.ToLower(path.Ext(rel))
	ctype, ok := config.AssetExt[ext]
	allowed := map[string]bool{ext: ok}
	if !ok || !config.SafeAsset(rel, allowed) {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(s.Config.Dir(), "brand", filepath.FromSlash(rel))
	st, err := os.Stat(full)
	if err != nil || st.IsDir() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-cache")
	if ext == ".svg" {
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
	}
	http.ServeFile(w, r, full)
}
