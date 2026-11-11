package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"lumantic/internal/adapter"
	"lumantic/internal/catalog"
	"lumantic/internal/config"
	"lumantic/internal/katalog"
	"lumantic/internal/metrics"
)

// The Sternkatalog: every key figure of a Kosmos with what it means, where it
// comes from and who answers for it, the tables it is read from, and the words
// of the business. Each field says its origin: the company catalog in the
// source, an addition in Lumantic, or a guess.

type field struct {
	Value any    `json:"value"`
	From  string `json:"from"` // quelle, lumantic, vermutet
}

type entry struct {
	ID     string           `json:"id"`
	Name   string           `json:"name"`
	Topic  string           `json:"topic"`
	Fields map[string]field `json:"fields"`
	Bounds []metrics.Bound  `json:"bounds"`
	Status string           `json:"status"` // what is missing in the gold layer, "" when it can be read
	First  string           `json:"first"`  // first and last month with data
	Last   string           `json:"last"`
}

type katalogView struct {
	Kosmos   string          `json:"kosmos"`
	Name     string          `json:"name"`
	Company  string          `json:"company"` // the company catalog's table, "" without one
	Problems []string        `json:"problems"`
	Editable bool            `json:"editable"` // the person may add to Lumantic's part
	Entries  []entry         `json:"entries"`
	Topics   []metrics.Group `json:"topics"`
	Terms    []metrics.Term  `json:"terms"`
	Tables   []catalog.Table `json:"tables"`
}

func (s *Server) getKatalog(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	rm, _ := s.room(id)
	u := userOf(r)
	out := katalogView{Kosmos: id, Name: rm.data.Name, Company: k.company, Problems: k.problems, Editable: s.edits(u, rm),
		Entries: []entry{}, Topics: []metrics.Group{}, Terms: []metrics.Term{}, Tables: []catalog.Table{}}
	if out.Problems == nil {
		out.Problems = []string{}
	}
	if !s.isAdmin(u) && k.company != "" {
		out.Company = "Fachkatalog" // where it lives in the source is a detail for those who look after it
	}
	if k.cat != nil {
		for _, t := range k.cat.Tables {
			if !katalog.IsContract(t.Name) {
				out.Tables = append(out.Tables, t)
			}
		}
	}
	m := k.merged
	if m == nil {
		writeJSON(w, 200, out)
		return
	}
	topics := map[string]string{}
	for _, g := range m.Groups {
		topics[g.ID] = g.Name
	}
	out.Topics = append(out.Topics, m.Groups...)
	out.Terms = append(out.Terms, m.Terms...)
	months := map[string][2]string{}
	if figs, _ := s.figuresFor(r, id, k); figs != nil {
		for _, kpi := range figs.KPIs {
			first, last := -1, -1
			for i, v := range kpi.Series {
				if v != nil {
					if first < 0 {
						first = i
					}
					last = i
				}
			}
			if first >= 0 {
				months[kpi.ID] = [2]string{figs.Months[first], figs.Months[last]}
			}
		}
	}
	for _, d := range m.KPIs {
		if !s.isAdmin(u) && !config.InGroups(u.Groups, d.Access) {
			continue
		}
		o := m.Origins[d.ID]
		from := func(f string) string {
			if o[f] == "" {
				return katalog.FromLumantic
			}
			return o[f]
		}
		f := map[string]field{
			"desc":    {d.Desc, from("desc")},
			"formula": {d.Formula, from("formula")},
			"owner":   {d.Owner, from("owner")},
			"unit":    {d.Unit, from("unit")},
			"kind":    {d.Kind, from("kind")},
			"dir":     {d.Dir, from("dir")},
			"topic":   {topics[d.Group], from("group")},
			"source":  {strings.Trim(d.Monthly.Table+"."+d.Monthly.Value, "."), from("source")},
		}
		if d.Parts != nil {
			parts := d.Parts.Split
			if parts == "" {
				var cols []string
				for _, c := range d.Parts.Columns {
					cols = append(cols, c.Name)
				}
				parts = strings.Join(cols, ", ")
			}
			f["parts"] = field{parts, from("parts")}
		}
		if d.Target != nil {
			f["target"] = field{*d.Target, from("target")}
		}
		// The raster its data gives, and for a flow how its target spreads over the year.
		f["raster"] = field{"monat", from("source")}
		if d.Daily != nil {
			f["raster"] = field{"tag", from("source")}
		}
		if d.Kind == "flow" {
			// A single target says what time it covers; budgets with validity say it themselves.
			if d.Target != nil {
				per := d.TargetPer
				if per == "" {
					per = "monat"
				}
				f["targetPer"] = field{per, from("target")}
			}
			ph := d.Phasing
			if ph == "" && len(d.Profile) == 12 {
				ph = "profil"
			} else if ph == "" {
				ph = m.Phasing
			}
			if ph == "" {
				ph = "monate"
			}
			f["phasing"] = field{ph, from("phasing")}
		}
		if d.Limit != nil {
			f["limit"] = field{*d.Limit, from("limit")}
		}
		e := entry{ID: d.ID, Name: d.Name, Topic: topics[d.Group], Fields: f, Bounds: d.Bounds}
		if missing := d.Missing(k.cat); len(missing) > 0 {
			e.Status = strings.Join(missing, ", ")
		}
		if e.Bounds == nil {
			e.Bounds = []metrics.Bound{}
		}
		e.First, e.Last = months[d.ID][0], months[d.ID][1]
		out.Entries = append(out.Entries, e)
	}
	writeJSON(w, 200, out)
}

// editable are the fields of a figure the Sternkatalog can change: words and
// the single target and limit. What a figure is read from stays with its
// definition.
var editable = map[string]string{"desc": "desc", "formula": "formula", "owner": "owner", "target": "target", "limit": "limit", "targetName": "target", "limitName": "limit",
	"targetPer": "target", "phasing": "phasing"}

var fieldNames = map[string]string{"desc": "Die Definition", "formula": "Die Berechnung", "owner": "Der Eigner", "target": "Das Ziel", "limit": "Die Grenze", "phasing": "Die Verteilung"}

// putKatalogEntry changes Lumantic's part of a figure. For a figure of the
// company catalog that is only what the catalog leaves open; it is kept as an
// addition, so the catalog's own words stay untouched.
func (s *Server) putKatalogEntry(w http.ResponseWriter, r *http.Request) {
	kid, k := s.pick(w, r)
	if k == nil {
		return
	}
	id := r.PathValue("id")
	var patch map[string]json.RawMessage
	if err := readJSON(r, &patch); err != nil {
		fail(w, 400, "Ungültiger Eintrag.")
		return
	}
	for key := range patch {
		if _, ok := editable[key]; !ok {
			fail(w, 422, fmt.Sprintf("Das Feld %q lässt sich im Sternkatalog nicht ändern.", key))
			return
		}
	}
	code, _, err := s.changeKPIs(r, kid, func(c *metrics.Config, cur *kosmos) (int, error) {
		var origins map[string]string
		if cur.merged != nil {
			origins = cur.merged.Origins[id]
		}
		for key := range patch {
			if origins[editable[key]] == katalog.FromSource {
				return 409, fmt.Errorf("%s kommt aus dem Fachkatalog und lässt sich nur dort ändern.", fieldNames[editable[key]])
			}
		}
		if i := c.Find(id); i >= 0 {
			return 0, applyPatch(&c.KPIs[i], patch)
		}
		if origins["name"] != katalog.FromSource {
			return 404, fmt.Errorf("Die Kennzahl %s gibt es nicht.", id)
		}
		if c.Extra == nil {
			c.Extra = map[string]metrics.Extra{}
		}
		ex := c.Extra[id]
		if err := applyExtra(&ex, patch); err != nil {
			return 422, err
		}
		c.Extra[id] = ex
		return 0, nil
	})
	if err != nil {
		failKPI(w, code, err)
		return
	}
	s.getKatalog(w, r)
}

func text(raw json.RawMessage) (string, error) {
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", errors.New("Bitte einen Text angeben.")
	}
	return strings.TrimSpace(v), nil
}

// number reads a number or null; null clears.
func number(raw json.RawMessage) (*float64, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	var v float64
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, errors.New("Ziel und Grenze sind Zahlen.")
	}
	return &v, nil
}

func applyPatch(d *metrics.Def, patch map[string]json.RawMessage) error {
	for key, raw := range patch {
		var err error
		switch key {
		case "desc":
			d.Desc, err = text(raw)
		case "formula":
			d.Formula, err = text(raw)
		case "owner":
			d.Owner, err = text(raw)
		case "targetName":
			d.TargetName, err = text(raw)
		case "limitName":
			d.LimitName, err = text(raw)
		case "target":
			d.Target, err = number(raw)
		case "limit":
			d.Limit, err = number(raw)
		case "targetPer":
			d.TargetPer, err = choice(raw, "monat", "jahr")
		case "phasing":
			if d.Phasing, err = choice(raw, "monate", "arbeitstage", "kalendertage"); err == nil {
				d.Profile = nil
			}
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// choice reads one of a few words; empty goes back to the standard.
func choice(raw json.RawMessage, words ...string) (string, error) {
	s, err := text(raw)
	if err != nil || s == "" {
		return "", err
	}
	for _, w := range words {
		if s == w {
			return s, nil
		}
	}
	return "", fmt.Errorf("Möglich sind %s.", strings.Join(words, ", "))
}

func applyExtra(ex *metrics.Extra, patch map[string]json.RawMessage) error {
	for key, raw := range patch {
		var err error
		switch key {
		case "desc":
			ex.Desc, err = text(raw)
		case "formula":
			ex.Formula, err = text(raw)
		case "owner":
			ex.Owner, err = text(raw)
		case "targetName":
			ex.TargetName, err = text(raw)
		case "limitName":
			ex.LimitName, err = text(raw)
		case "target":
			ex.Target, err = number(raw)
		case "limit":
			ex.Limit, err = number(raw)
		case "targetPer":
			ex.TargetPer, err = choice(raw, "monat", "jahr")
		case "phasing":
			ex.Phasing, err = choice(raw, "monate", "arbeitstage", "kalendertage")
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// putTerms replaces the words Lumantic keeps for a Kosmos. The company
// catalog's words stay as they are.
func (s *Server) putTerms(w http.ResponseWriter, r *http.Request) {
	kid, k := s.pick(w, r)
	if k == nil {
		return
	}
	var req struct {
		Terms []metrics.Term `json:"terms"`
	}
	if err := readJSON(r, &req); err != nil {
		fail(w, 400, "Ungültige Begriffe.")
		return
	}
	if len(req.Terms) > 500 {
		fail(w, 422, "Höchstens 500 Begriffe.")
		return
	}
	var terms []metrics.Term
	for _, t := range req.Terms {
		t.Term, t.Definition, t.KPI, t.Origin = strings.TrimSpace(t.Term), strings.TrimSpace(t.Definition), strings.TrimSpace(t.KPI), ""
		if t.Term == "" {
			continue
		}
		if t.Definition == "" {
			fail(w, 422, fmt.Sprintf("Der Begriff «%s» braucht eine Erklärung.", t.Term))
			return
		}
		var syn []string
		for _, x := range t.Synonyms {
			if x = strings.TrimSpace(x); x != "" {
				syn = append(syn, x)
			}
		}
		t.Synonyms = syn
		terms = append(terms, t)
	}
	code, _, err := s.changeKPIs(r, kid, func(c *metrics.Config, cur *kosmos) (int, error) {
		c.Terms = terms
		return 0, nil
	})
	if err != nil {
		failKPI(w, code, err)
		return
	}
	s.getKatalog(w, r)
}

// exportKatalog hands out a Kosmos's catalog: as SQL for the gold layer
// (the contract's three views, in the source's SQL), or as a Lumantic file.
func (s *Server) exportKatalog(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	if k.merged == nil {
		fail(w, 503, errNoFigures.Error())
		return
	}
	if r.URL.Query().Get("format") == "json" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="kennzahlen-%s.json"`, id))
		writeJSON(w, 200, k.merged)
		return
	}
	d := adapter.DialectFor("duckdb")
	if k.ad != nil {
		d = adapter.DialectOf(k.ad)
	}
	w.Header().Set("Content-Type", "application/sql; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="lumantic-katalog-%s.sql"`, id))
	w.Write([]byte(katalog.SQL(k.merged, "lumantic", d)))
}
