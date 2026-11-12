package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/i18n"
	"github.com/Dominik1407/lumantic/internal/metrics"
	"github.com/Dominik1407/lumantic/internal/source"
)

// A person may see more than one gold layer. Each is a Kosmos of its own; the
// main menu lists them and jumps into one. The first Kosmos is the "data" and
// "metrics" at the top of the config file; the others live under "kosmen".

// maxKosmen keeps the menu a menu.
const maxKosmen = 24

// KosmosInfo is one entry of the main menu.
type KosmosInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"` // "duckdb", "files", "snowflake", "databricks" or "windmill"
	Main   bool   `json:"main"`
	Status Status `json:"status"`
}

func (s *Server) infoOf(rm room) KosmosInfo {
	return KosmosInfo{ID: rm.id, Name: rm.data.Name, Type: rm.data.Type, Main: rm.id == config.MainID, Status: s.status(rm.id)}
}

// Kosmen lists every Kosmos with its status, the first one first.
func (s *Server) Kosmen() []KosmosInfo {
	out := []KosmosInfo{}
	for _, rm := range s.rooms() {
		out = append(out, s.infoOf(rm))
	}
	return out
}

// getKosmen lists the Kosmen the person may see; the others do not appear in
// their main menu at all.
func (s *Server) getKosmen(w http.ResponseWriter, r *http.Request) {
	out := []KosmosInfo{}
	u := userOf(r)
	for _, rm := range s.rooms() {
		if s.sees(u, rm) {
			info := s.infoOf(rm)
			// In English a Kosmos named like its definitions reads by their English title.
			if k := s.get(rm.id); k != nil && k.merged != nil && i18n.Wants(r) && k.merged.Title == info.Name && k.merged.En["title"] != "" {
				info.Name = k.merged.En["title"]
			}
			out = append(out, info)
		}
	}
	writeJSON(w, 200, map[string]any{"kosmen": out})
}

// addKosmos connects one more data source as a Kosmos of its own. The source
// must answer before anything is saved. Key figures come later, from the
// settings of the new Kosmos, or with "metrics": a definitions file.
func (s *Server) addKosmos(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Data    json.RawMessage   `json:"data"`
		Metrics string            `json:"metrics"`
		Secrets map[string]string `json:"secrets"` // tokens of the new source, stored once it answers
	}
	if err := readJSON(r, &req); err != nil || len(req.Data) == 0 {
		fail(w, 400, "Ungültiger Kosmos.")
		return
	}
	d := config.DefaultData()
	d.Name, d.Path = "", ""
	if err := json.Unmarshal(req.Data, &d); err != nil {
		fail(w, 400, "Ungültige Datenquelle.")
		return
	}
	config.NormalizeData(&d)
	if d.Name == "" {
		fail(w, 422, "Der Kosmos braucht einen Namen.")
		return
	}
	if err := config.ValidateData(d); err != nil {
		fail(w, 422, err.Error())
		return
	}
	s.edit.Lock()
	defer s.edit.Unlock()
	c := s.Config.File()
	if len(c.Kosmen)+1 >= maxKosmen {
		fail(w, 409, fmt.Sprintf("Mehr als %d Kosmen sind nicht möglich.", maxKosmen))
		return
	}
	// The DuckDB program of the first Kosmos is shared, not written down again.
	if d.DuckDB == s.Config.Effective().Data.DuckDB {
		d.DuckDB = ""
	}
	base := metrics.Slug(d.Name)
	if !config.ValidID(base) {
		base = "kosmos"
	}
	id := base
	for n := 2; c.Find(id) >= 0; n++ {
		id = fmt.Sprintf("%s-%d", base, n)
	}
	rm := room{id: id, data: d, metrics: req.Metrics}
	defs, err := defsFor(rm)
	if err != nil {
		fail(w, 422, fmt.Sprintf("Die Kennzahlen-Datei %s lässt sich nicht lesen: %v", req.Metrics, err))
		return
	}
	ad, err := s.build(id, d, req.Secrets)
	if err != nil {
		fail(w, 422, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	l := load(ctx, ad, defs, nil, d.Name, true)
	cancel()
	if l.err != nil {
		fail(w, 422, "Die Datenquelle ist nicht erreichbar: "+source.Explain(l.err))
		return
	}
	for key, v := range req.Secrets {
		if config.PerKosmos(key) && strings.TrimSpace(v) != "" {
			if _, err := s.Config.SetSecret(config.KosmosKey(key, id), v); err != nil {
				fail(w, 422, err.Error())
				return
			}
		}
	}
	c.Kosmen = append(c.Kosmen, config.Kosmos{ID: id, Data: d, Metrics: req.Metrics})
	if err := s.Config.Save(c); err != nil {
		s.Config.DropSecrets(id)
		fail(w, 500, err.Error())
		return
	}
	s.put(id, (&kosmos{defs: defs}).with(ad, l))
	writeJSON(w, 201, s.infoOf(rm))
}

// deleteKosmos removes a Kosmos from the settings together with the pages
// people built in it. Its data source and its key figure file are not touched.
func (s *Server) deleteKosmos(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == config.MainID {
		fail(w, 409, "Der erste Kosmos lässt sich nicht entfernen. Du kannst ihm eine andere Datenquelle geben.")
		return
	}
	s.edit.Lock()
	defer s.edit.Unlock()
	c := s.Config.File()
	i := c.Find(id)
	if i < 0 {
		fail(w, 404, errNoKosmos.Error())
		return
	}
	c.Kosmen = append(c.Kosmen[:i], c.Kosmen[i+1:]...)
	if err := s.Config.Save(c); err != nil {
		fail(w, 500, err.Error())
		return
	}
	s.mu.Lock()
	delete(s.ks, id)
	s.mu.Unlock()
	if err := s.Store.DropWorkspace(id); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if err := s.Config.DropSecrets(id); err != nil {
		fail(w, 500, err.Error())
		return
	}
	w.WriteHeader(204)
}

// Line says in a few words how a Kosmos is doing, for the start log.
func (i KosmosInfo) Line() string {
	if !i.Status.OK {
		return i.Status.Error
	}
	return fmt.Sprintf("bereit, %d Kennzahlen", i.Status.KPIsLoaded)
}
