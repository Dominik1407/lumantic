package server

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"lumantic/internal/card"
	"lumantic/internal/config"
	"lumantic/internal/engine"
	"lumantic/internal/lumina"
	"lumantic/internal/store"
)

// The first board: questions become cards with a fixed calculation. Kosmos
// does not use these endpoints; they stay for scripts that still do.

// asOf picks the requested week, or the latest one with data.
func (s *Server) asOf(raw string) (time.Time, error) {
	_, weeks := s.catalog()
	if raw == "" {
		if len(weeks) == 0 {
			return time.Now().UTC().Truncate(24 * time.Hour), nil
		}
		raw = weeks[len(weeks)-1]
	}
	return time.Parse("2006-01-02", raw)
}

func (s *Server) meta(w http.ResponseWriter, r *http.Request) {
	cat, weeks := s.catalog()
	ad, tr := s.adapter(), s.translator()
	writeJSON(w, 200, map[string]any{
		"product": "Lumantic",
		"slogan":  "Quiet until it matters.",
		"adapter": ad.Name(),
		"dialect": ad.Dialect(),
		"source":  cat.Source,
		"lumina":  map[string]string{"mode": tr.Mode(), "model": tr.Model()},
		"weeks":   weeks,
	})
}

func (s *Server) refreshCatalog(w http.ResponseWriter, r *http.Request) {
	if err := s.readNow(r.Context(), config.MainID, byHand); err != nil {
		fail(w, 502, "Der Goldlayer ist nicht erreichbar: "+err.Error())
		return
	}
	s.getCatalog(w, r)
}

func (s *Server) board(w http.ResponseWriter, r *http.Request) {
	asOf, err := s.asOf(r.URL.Query().Get("asOf"))
	if err != nil {
		fail(w, 400, "Ungültiges Datum.")
		return
	}
	cat, _ := s.catalog()
	writeJSON(w, 200, engine.Evaluate(r.Context(), s.adapter(), cat, s.Store.Cards(), asOf))
}

func (s *Server) suggestions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, lumina.Suggestions(s.Store.Cards(), 4))
}

// translateError maps Lumina's errors to responses: "no answer" is the
// person's question not fitting the data; anything else is a service problem.
func translateError(w http.ResponseWriter, err error) {
	var na *lumina.NoAnswer
	if errors.As(err, &na) {
		fail(w, 422, na.Msg)
		return
	}
	fail(w, 502, err.Error())
}

func (s *Server) ask(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Question string `json:"question"`
		AsOf     string `json:"asOf"`
	}
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.Question) == "" {
		fail(w, 400, "Bitte stell eine Frage.")
		return
	}
	asOf, err := s.asOf(req.AsOf)
	if err != nil {
		fail(w, 400, "Ungültiges Datum.")
		return
	}
	cat, _ := s.catalog()
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	specs, err := s.translator().Ask(ctx, cat, req.Question)
	if err != nil {
		translateError(w, err)
		return
	}
	spec := specs[0]
	if err := spec.Validate(cat); err != nil {
		fail(w, 422, "Lumina hat die Frage verstanden, aber die Karte passt nicht zum Katalog: "+err.Error())
		return
	}
	c, err := s.Store.Add(spec, "lumina")
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, engine.EvaluateCard(r.Context(), s.adapter(), cat, c, asOf))
}

func (s *Server) brief(w http.ResponseWriter, r *http.Request) {
	var req struct {
		About   string `json:"about"`
		Replace bool   `json:"replace"`
	}
	if err := readJSON(r, &req); err != nil || strings.TrimSpace(req.About) == "" {
		fail(w, 400, "Erzähl Lumina kurz, wer du bist und was dich interessiert.")
		return
	}
	cat, _ := s.catalog()
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	specs, err := s.translator().Brief(ctx, cat, req.About)
	if err != nil {
		translateError(w, err)
		return
	}
	var valid []card.Spec
	var skipped []string
	for _, spec := range specs {
		if err := spec.Validate(cat); err != nil {
			skipped = append(skipped, spec.Question+": "+err.Error())
			continue
		}
		valid = append(valid, spec)
	}
	if len(valid) == 0 {
		fail(w, 422, "Lumina konnte daraus keine passenden Karten bauen.")
		return
	}
	if req.Replace {
		// A new start removes the cards; the team's notes stay.
		for _, c := range s.Store.Cards() {
			if err := s.Store.Remove(c.ID); err != nil {
				fail(w, 500, err.Error())
				return
			}
		}
	}
	existing := map[string]bool{}
	for _, c := range s.Store.Cards() {
		existing[c.Spec.Question] = true
	}
	added := 0
	for _, spec := range valid {
		if existing[spec.Question] {
			continue
		}
		if _, err := s.Store.Add(spec, "briefing"); err != nil {
			fail(w, 500, err.Error())
			return
		}
		added++
	}
	writeJSON(w, 200, map[string]any{"added": added, "skipped": skipped})
}

func (s *Server) addCard(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Spec card.Spec `json:"spec"`
		AsOf string    `json:"asOf"`
	}
	if err := readJSON(r, &req); err != nil {
		fail(w, 400, "Ungültige Karte.")
		return
	}
	cat, _ := s.catalog()
	if err := req.Spec.Validate(cat); err != nil {
		fail(w, 422, err.Error())
		return
	}
	asOf, err := s.asOf(req.AsOf)
	if err != nil {
		fail(w, 400, "Ungültiges Datum.")
		return
	}
	c, err := s.Store.Add(req.Spec, "vorschlag")
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, engine.EvaluateCard(r.Context(), s.adapter(), cat, c, asOf))
}

func (s *Server) setRule(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Good *card.Rule `json:"good"`
	}
	if err := readJSON(r, &req); err != nil {
		fail(w, 400, "Ungültige Regel.")
		return
	}
	id := r.PathValue("id")
	cat, _ := s.catalog()
	for _, c := range s.Store.Cards() {
		if c.ID != id {
			continue
		}
		spec := c.Spec
		spec.Good = req.Good
		if err := spec.Validate(cat); err != nil {
			fail(w, 422, err.Error())
			return
		}
		updated, err := s.Store.SetRule(id, spec.Good)
		if err != nil {
			fail(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, updated)
		return
	}
	fail(w, 404, store.ErrNotFound.Error())
}

func (s *Server) removeCard(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.Remove(r.PathValue("id")); err != nil {
		fail(w, 404, err.Error())
		return
	}
	w.WriteHeader(204)
}

func (s *Server) reset(w http.ResponseWriter, r *http.Request) {
	if err := s.Store.Reset(lumina.StartBoard(), store.StartNotes); err != nil {
		fail(w, 500, err.Error())
		return
	}
	cards := s.Store.Cards()
	sort.Slice(cards, func(a, b int) bool { return cards[a].Created.Before(cards[b].Created) })
	writeJSON(w, 200, cards)
}
