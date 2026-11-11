package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"lumantic/internal/config"
	"lumantic/internal/metrics"
)

// Key figures can be added, changed and removed from the settings, per Kosmos
// (?k=<id>). The definitions stay a file the analysts own: config/kennzahlen.json
// for the first Kosmos (the first change copies the built-in ALCO definitions
// there), config/kennzahlen-<id>.json for every other.

type kpiView struct {
	metrics.Def
	Status string `json:"status"`
}

func missingText(missing []string) string {
	if len(missing) == 0 {
		return "ok"
	}
	return "fehlt: " + strings.Join(missing, ", ")
}

func (s *Server) getKPIs(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	defs, defsErr, cat := k.defs, k.defsErr, k.cat
	if defs == nil {
		msg := "Die Kennzahlen-Datei lässt sich nicht lesen."
		if defsErr != nil {
			msg += " " + defsErr.Error()
		}
		fail(w, 503, msg)
		return
	}
	rm, _ := s.room(id)
	file := rm.metrics
	out := struct {
		File    string          `json:"file"`
		BuiltIn bool            `json:"builtIn"`
		Groups  []metrics.Group `json:"groups"`
		KPIs    []kpiView       `json:"kpis"`
	}{File: file, BuiltIn: file == "" && id == config.MainID, Groups: defs.Groups, KPIs: []kpiView{}}
	if out.Groups == nil {
		out.Groups = []metrics.Group{}
	}
	for _, k := range defs.KPIs {
		out.KPIs = append(out.KPIs, kpiView{Def: k, Status: missingText(k.Missing(cat))})
	}
	writeJSON(w, 200, out)
}

var kpiIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,39}$`)

// changeKPIs runs one edit on a copy of a Kosmos's definitions, writes the
// file, installs it and reloads the figures. kid is the Kosmos.
func (s *Server) changeKPIs(r *http.Request, kid string, edit func(*metrics.Config, *kosmos) (int, error)) (int, *metrics.Config, error) {
	s.edit.Lock()
	defer s.edit.Unlock()
	cur := s.get(kid)
	rm, ok := s.room(kid)
	if cur == nil || !ok {
		return 404, nil, errNoKosmos
	}
	if cur.defs == nil {
		return 503, nil, fmt.Errorf("Die Kennzahlen-Datei lässt sich nicht lesen: %v", cur.defsErr)
	}
	next := cur.defs.Clone()
	if code, err := edit(next, cur); err != nil {
		return code, nil, err
	}
	path, first := rm.metrics, rm.metrics == ""
	if first {
		name := "kennzahlen.json"
		if kid != config.MainID {
			name = "kennzahlen-" + kid + ".json"
		}
		path = filepath.ToSlash(filepath.Join(s.Config.Dir(), name))
	}
	if err := next.Save(path); err != nil {
		return 500, nil, fmt.Errorf("Die Kennzahlen lassen sich nicht speichern: %w", err)
	}
	if first {
		c := s.Config.File()
		if i := c.Find(kid); i >= 0 {
			c.Kosmen[i].Metrics = path
		} else {
			c.Metrics = path
		}
		if err := s.Config.Save(c); err != nil {
			return 500, nil, err
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	l := load(ctx, cur.ad, next, nil, rm.data.Name)
	cancel()
	s.put(kid, (&kosmos{defs: next}).with(cur.ad, l))
	return 0, next, nil
}

func (s *Server) kpiResponse(w http.ResponseWriter, code int, kid string, defs *metrics.Config, id string) {
	i := defs.Find(id)
	k := defs.KPIs[i]
	writeJSON(w, code, kpiView{Def: k, Status: missingText(k.Missing(s.get(kid).cat))})
}

func failKPI(w http.ResponseWriter, code int, err error) {
	if code == 0 {
		code = 422
	}
	fail(w, code, err.Error())
}

func (s *Server) addKPI(w http.ResponseWriter, r *http.Request) {
	kid, k := s.pick(w, r)
	if k == nil {
		return
	}
	var in metrics.Input
	if err := readJSON(r, &in); err != nil {
		fail(w, 400, "Ungültige Kennzahl.")
		return
	}
	var id string
	code, defs, err := s.changeKPIs(r, kid, func(c *metrics.Config, cur *kosmos) (int, error) {
		cat := cur.cat
		in.ID = strings.TrimSpace(in.ID)
		switch {
		case in.ID == "":
			in.ID = c.UniqueID(metrics.Slug(in.Name))
		case !kpiIDRe.MatchString(in.ID):
			return 422, errors.New("Die ID darf nur Kleinbuchstaben, Ziffern, - und _ enthalten.")
		case c.Find(in.ID) >= 0:
			return 409, fmt.Errorf("Die Kennzahl %s gibt es schon.", in.ID)
		}
		d, err := c.Prepare(in, cat)
		if err != nil {
			return 422, err
		}
		c.KPIs = append(c.KPIs, d)
		id = d.ID
		return 0, nil
	})
	if err != nil {
		failKPI(w, code, err)
		return
	}
	s.kpiResponse(w, 201, kid, defs, id)
}

// updateKPI lays the given fields over the stored definition; the id stays.
func (s *Server) updateKPI(w http.ResponseWriter, r *http.Request) {
	kid, k := s.pick(w, r)
	if k == nil {
		return
	}
	id := r.PathValue("id")
	var patch map[string]json.RawMessage
	if err := readJSON(r, &patch); err != nil {
		fail(w, 400, "Ungültige Kennzahl.")
		return
	}
	delete(patch, "id")
	delete(patch, "status")
	code, defs, err := s.changeKPIs(r, kid, func(c *metrics.Config, cur *kosmos) (int, error) {
		cat := cur.cat
		i := c.Find(id)
		if i < 0 {
			return 404, fmt.Errorf("Die Kennzahl %s gibt es nicht.", id)
		}
		base, _ := json.Marshal(c.KPIs[i])
		var merged map[string]json.RawMessage
		json.Unmarshal(base, &merged)
		for k, v := range patch {
			merged[k] = v
		}
		raw, _ := json.Marshal(merged)
		var in metrics.Input
		if err := json.Unmarshal(raw, &in); err != nil {
			return 400, errors.New("Ungültige Kennzahl.")
		}
		in.ID = id
		d, err := c.Prepare(in, cat)
		if err != nil {
			return 422, err
		}
		c.KPIs[i] = d
		return 0, nil
	})
	if err != nil {
		failKPI(w, code, err)
		return
	}
	s.kpiResponse(w, 200, kid, defs, id)
}

func (s *Server) deleteKPI(w http.ResponseWriter, r *http.Request) {
	kid, k := s.pick(w, r)
	if k == nil {
		return
	}
	id := r.PathValue("id")
	code, _, err := s.changeKPIs(r, kid, func(c *metrics.Config, _ *kosmos) (int, error) {
		i := c.Find(id)
		if i < 0 {
			return 404, fmt.Errorf("Die Kennzahl %s gibt es nicht.", id)
		}
		c.KPIs = append(c.KPIs[:i], c.KPIs[i+1:]...)
		return 0, nil
	})
	if err != nil {
		failKPI(w, code, err)
		return
	}
	w.WriteHeader(204)
}
