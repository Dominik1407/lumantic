package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Dominik1407/lumantic/internal/ai"
	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/i18n"
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
	q.Lang = i18n.Lang(r)
	s.withMeaning(r, &q)
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

// withMeaning adds what the catalog of the Kosmos named with ?k= says: the
// definition of each figure asked about, and the words of the business with
// their synonyms. Only figures the page sent get a definition, so Lumina never
// learns of figures the person may not see.
func (s *Server) withMeaning(r *http.Request, q *ai.Question) {
	id := r.URL.Query().Get("k")
	if id == "" {
		id = config.MainID
	}
	k := s.get(id)
	rm, ok := s.room(id)
	if !ok || k == nil || k.merged == nil || !s.sees(userOf(r), rm) {
		return
	}
	// In English the words a team wrote in English, where it did.
	english := q.Lang == "en"
	desc := map[string]string{}
	for _, d := range k.merged.KPIs {
		desc[d.ID] = d.En.Or(english, "desc", d.Desc)
	}
	sent := map[string]bool{}
	for i := range q.Facts.Figures {
		f := &q.Facts.Figures[i]
		sent[f.ID] = true
		if f.Definition == "" {
			f.Definition = desc[f.ID]
		}
	}
	q.Words = nil
	for _, t := range k.merged.Terms {
		if t.KPI != "" && !sent[t.KPI] {
			continue
		}
		if len(q.Words) == 100 {
			break
		}
		syn := t.Synonyms
		if t.En.Or(english, "term", "") != "" {
			syn = append([]string{t.Term}, syn...) // the German word still finds it
		}
		q.Words = append(q.Words, ai.Word{Term: t.En.Or(english, "term", t.Term), Definition: t.En.Or(english, "definition", t.Definition), Synonyms: syn, Figure: t.KPI})
	}
}
