package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"lumantic/internal/ai"
)

// askLumina answers a question about the month the page shows. The app sends
// the facts it shows (figures, not rows); the server adds the token and asks
// Claude. Without a ready AI it answers 409 and the app uses its own matching.
func (s *Server) askLumina(w http.ResponseWriter, r *http.Request) {
	var q ai.Question
	if err := readJSON(r, &q); err != nil {
		fail(w, 400, "Ungültige Frage.")
		return
	}
	q.Question = strings.TrimSpace(q.Question)
	switch {
	case q.Question == "":
		fail(w, 400, "Bitte stell eine Frage.")
		return
	case utf8.RuneCountInString(q.Question) > 2000:
		fail(w, 400, "Die Frage ist zu lang (höchstens 2000 Zeichen).")
		return
	case len(q.Facts.Figures) == 0:
		fail(w, 400, "Es fehlen die Kennzahlen des Monats.")
		return
	case len(q.Facts.Figures) > 300:
		fail(w, 400, "Zu viele Kennzahlen auf einmal (höchstens 300).")
		return
	}
	s.mu.RLock()
	lum := s.lum
	s.mu.RUnlock()
	if lum == nil {
		eff := s.Config.Effective()
		msg := "Für Lumina ist kein API-Token gesetzt."
		if !eff.AI.Enabled {
			msg = "Lumina ist ohne KI eingestellt."
		}
		fail(w, 409, msg)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	ans, err := lum.Ask(ctx, q)
	var nf *ai.NoFit
	switch {
	case errors.As(err, &nf):
		fail(w, 422, nf.Msg)
		return
	case err != nil:
		fail(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, ans)
}
