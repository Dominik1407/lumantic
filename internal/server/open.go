package server

import (
	"net/http"

	"github.com/Dominik1407/lumantic/internal/config"
)

// Without a login, Lumantic open to others shows only the examples it writes
// itself (Server.ExamplesOnly): a quick look in a container stays harmless.
// Whoever wants own data there sets up a login, or says LUMANTIC_OPEN=1.
const msgExamplesOnly = "Ohne Anmeldung zeigt Lumantic hier nur die Beispiele. Für eigene Daten richte eine Anmeldung ein oder setz LUMANTIC_OPEN=1 (siehe config/README.md)."

// notOpen refuses what would bring own data or tokens into a Lumantic that is
// open without a login.
func (s *Server) notOpen(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.ExamplesOnly {
			fail(w, 403, msgExamplesOnly)
			return
		}
		next(w, r)
	}
}

// health answers a container's question whether Lumantic runs. It needs no
// login and says nothing about the data.
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "version": config.Version})
}
