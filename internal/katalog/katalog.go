// Package katalog brings a Kosmos's meaning together: a company catalog that
// the team keeps in its gold layer, what people add in Lumantic, and what
// Lumantic guesses from column names. The order holds field by field: the
// company catalog first, then Lumantic, then the guess. Every field keeps
// where it came from, so the Sternkatalog can say it.
//
// The contract with a company catalog is three tables or views with fixed
// names, in any schema the source shows:
//
//	lumantic_kennzahlen  id, name, definition, thema, einheit, art, richtung,
//	                     tabelle, wert_spalte, zeit_spalte, teile_spalte, eigner, berechnung
//	lumantic_ziele       kennzahl_id, art (Ziel or Grenze), wert, name, gueltig_ab, gueltig_bis
//	lumantic_begriffe    begriff, definition, synonyme, kennzahl_id
//
// Only lumantic_kennzahlen is required; missing columns are left open. Words in
// English may stand beside the German ones: name_en, definition_en, thema_en,
// berechnung_en, begriff_en, and name_en of a target or limit; the English
// interface reads them.
package katalog

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/catalog"
	"github.com/Dominik1407/lumantic/internal/metrics"
)

// Where a value comes from.
const (
	FromSource   = "quelle"   // the company catalog in the source, or the source's own comments
	FromLumantic = "lumantic" // added in Lumantic
	Guessed      = "vermutet" // guessed from types and column names; a suggestion
)

// The names of the contract.
const (
	TableKPIs   = "lumantic_kennzahlen"
	TableBounds = "lumantic_ziele"
	TableTerms  = "lumantic_begriffe"
)

// IsContract says whether a table belongs to the contract, so it is not offered
// as data.
func IsContract(table string) bool {
	n := strings.ToLower(table)
	if i := strings.LastIndex(n, "."); i >= 0 {
		n = n[i+1:]
	}
	return n == TableKPIs || n == TableBounds || n == TableTerms
}

// contract finds the tables of the contract in a catalog; "" where one is missing.
func contract(cat *catalog.Catalog) (kpis, bounds, terms string) {
	if cat == nil {
		return
	}
	for _, t := range cat.Tables {
		n := strings.ToLower(t.Name)
		if i := strings.LastIndex(n, "."); i >= 0 {
			n = n[i+1:]
		}
		switch n {
		case TableKPIs:
			if kpis == "" {
				kpis = t.Name
			}
		case TableBounds:
			if bounds == "" {
				bounds = t.Name
			}
		case TableTerms:
			if terms == "" {
				terms = t.Name
			}
		}
	}
	return
}

// Company is a company catalog as read from the source.
type Company struct {
	Table    string        // where it lives, e.g. lumantic.lumantic_kennzahlen
	KPIs     []metrics.Def // as far as the catalog fills them
	Topics   []metrics.Group
	Bounds   map[string][]metrics.Bound
	Terms    []metrics.Term
	Set      map[string]map[string]bool // which fields the catalog filled, per figure
	Problems []string                   // rows that could not be used, in sentences
}

// Read reads the company catalog of a source. Without the contract's first
// table it returns nil and no error: the Kosmos then has no company catalog.
func Read(ctx context.Context, ad adapter.Adapter, cat *catalog.Catalog) (*Company, error) {
	kt, bt, tt := contract(cat)
	if kt == "" {
		return nil, nil
	}
	// The three tables are read side by side: on a warehouse each is a round trip.
	d := adapter.DialectOf(ad)
	var brows, trows []adapter.Row
	var berr, terr error
	var wg sync.WaitGroup
	for _, q := range []struct {
		table string
		rows  *[]adapter.Row
		err   *error
	}{{bt, &brows, &berr}, {tt, &trows, &terr}} {
		if q.table != "" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				*q.rows, *q.err = ad.Query(ctx, "SELECT * FROM "+d.Table(q.table))
			}()
		}
	}
	rows, err := ad.Query(ctx, "SELECT * FROM "+d.Table(kt))
	wg.Wait()
	if err != nil {
		return nil, fmt.Errorf("Fachkatalog %s: %w", kt, err)
	}
	c := &Company{Table: kt, Bounds: map[string][]metrics.Bound{}, Set: map[string]map[string]bool{}}
	topics := map[string]bool{}
	for _, r := range rows {
		id := slug(str(r, "id"))
		if id == "" {
			id = slug(str(r, "name"))
		}
		if id == "" {
			c.Problems = append(c.Problems, "Eine Zeile ohne id und Name ist übersprungen.")
			continue
		}
		set := map[string]bool{}
		k := metrics.Def{ID: id}
		fill := func(field string, v string, to *string) {
			if v != "" {
				*to, set[field] = v, true
			}
		}
		fill("name", str(r, "name"), &k.Name)
		fill("desc", str(r, "definition"), &k.Desc)
		k.En = k.En.With("name", str(r, "name_en")).With("desc", str(r, "definition_en")).With("formula", str(r, "berechnung_en"))
		fill("formula", str(r, "berechnung"), &k.Formula)
		fill("owner", str(r, "eigner"), &k.Owner)
		if u := unitFrom(str(r, "einheit")); u != "" {
			k.Unit, set["unit"] = u, true
		}
		if kind := kindFrom(str(r, "art")); kind != "" {
			k.Kind, set["kind"] = kind, true
		}
		if dir, ok := dirFrom(str(r, "richtung")); ok {
			k.Dir, set["dir"] = dir, true
		}
		if topic := str(r, "thema"); topic != "" {
			k.Group, set["group"] = slug(topic), true
			if !topics[k.Group] {
				topics[k.Group] = true
				c.Topics = append(c.Topics, metrics.Group{ID: k.Group, Name: topic, En: metrics.Words(nil).With("name", str(r, "thema_en"))})
			}
		}
		k.Monthly = metrics.Source{Table: str(r, "tabelle"), Value: str(r, "wert_spalte"), Time: str(r, "zeit_spalte")}
		if k.Monthly.Table != "" && k.Monthly.Value != "" {
			set["source"] = true
		}
		if split := str(r, "teile_spalte"); split != "" {
			k.Parts, set["parts"] = &metrics.Parts{Mode: "sum", Split: split}, true
		}
		if k.Name == "" {
			k.Name = id
		}
		c.KPIs = append(c.KPIs, k)
		c.Set[id] = set
	}
	if bt != "" {
		if berr != nil {
			c.Problems = append(c.Problems, fmt.Sprintf("Die Ziele (%s) lassen sich nicht lesen: %v", bt, berr))
		}
		for _, r := range brows {
			id := slug(str(r, "kennzahl_id"))
			v, ok := adapter.Float(r, "wert")
			if !ok {
				v, ok = parseNum(str(r, "wert"))
			}
			kind := boundKind(str(r, "art"))
			if id == "" || !ok || kind == "" {
				c.Problems = append(c.Problems, fmt.Sprintf("Ein Ziel für %q ohne Wert oder Art ist übersprungen.", str(r, "kennzahl_id")))
				continue
			}
			c.Bounds[id] = append(c.Bounds[id], metrics.Bound{Kind: kind, Value: v, Name: str(r, "name"), En: metrics.Words(nil).With("name", str(r, "name_en")),
				From: dateOf(str(r, "gueltig_ab")), Until: dateOf(str(r, "gueltig_bis")), Per: perFrom(str(r, "periode")), Origin: FromSource})
		}
	}
	if tt != "" {
		if terr != nil {
			c.Problems = append(c.Problems, fmt.Sprintf("Die Begriffe (%s) lassen sich nicht lesen: %v", tt, terr))
		}
		for _, r := range trows {
			t := metrics.Term{Term: str(r, "begriff"), Definition: str(r, "definition"), KPI: slug(str(r, "kennzahl_id")), Origin: FromSource,
				En: metrics.Words(nil).With("term", str(r, "begriff_en")).With("definition", str(r, "definition_en"))}
			for _, syn := range listSep.Split(str(r, "synonyme"), -1) {
				if syn = strings.TrimSpace(syn); syn != "" {
					t.Synonyms = append(t.Synonyms, syn)
				}
			}
			if t.Term != "" {
				c.Terms = append(c.Terms, t)
			}
		}
	}
	return c, nil
}

// Merge puts the company catalog, Lumantic's own definitions and guesses
// together into the definitions a Kosmos reads its figures with. own stays as
// it is; the result carries the origin of every field. Figures that cannot be
// read (no table, a column missing) stay in, with a problem noted; the figures
// load leaves them out on its own.
func Merge(company *Company, own *metrics.Config, cat *catalog.Catalog) (*metrics.Config, []string) {
	out := own.Clone()
	out.Origins = map[string]map[string]string{}
	origin := func(id string) map[string]string {
		if out.Origins[id] == nil {
			out.Origins[id] = map[string]string{}
		}
		return out.Origins[id]
	}
	for _, k := range out.KPIs {
		o := origin(k.ID)
		for _, f := range []string{"name", "desc", "formula", "owner", "unit", "kind", "dir", "group", "source", "parts", "target", "limit"} {
			o[f] = FromLumantic
		}
		for i := range k.Bounds {
			k.Bounds[i].Origin = FromLumantic
		}
	}
	for i := range out.Terms {
		out.Terms[i].Origin = FromLumantic
	}
	if company == nil {
		return out, nil
	}
	var problems []string
	problems = append(problems, company.Problems...)
	ownAt := map[string]int{}
	for i, k := range out.KPIs {
		ownAt[k.ID] = i
	}
	groups := map[string]bool{}
	for _, g := range out.Groups {
		groups[g.ID] = true
	}
	for _, g := range company.Topics {
		if !groups[g.ID] {
			groups[g.ID] = true
			out.Groups = append(out.Groups, g)
		}
	}
	var merged []metrics.Def
	taken := map[string]bool{}
	for _, ck := range company.KPIs {
		k, o, set := ck, origin(ck.ID), company.Set[ck.ID]
		for f := range set {
			o[f] = FromSource
		}
		o["name"] = FromSource
		// Lumantic fills what the catalog leaves open: a full definition of the
		// same figure, or additions kept for it.
		if i, ok := ownAt[ck.ID]; ok {
			fillFrom(&k, own.KPIs[i], o)
			taken[ck.ID] = true
		}
		if ex, ok := own.Extra[ck.ID]; ok {
			addExtra(&k, ex, o)
		}
		guess(&k, cat, o)
		// A ratio adds up over a quarter from its numerator and denominator. Without them its months are averaged,
		// which is near but not exact, and the catalog says so.
		if k.Kind == "ratio" && (k.Parts == nil || k.Parts.Mode != "ratio") {
			k.Kind = "avg"
			problems = append(problems, fmt.Sprintf("%s: Ein Verhältnis braucht Zähler und Nenner (parts mit mode ratio). Bis dahin mittelt Lumantic die Monate eines Quartals.", k.Name))
		}
		if !groups[k.Group] {
			groups[k.Group] = true
			out.Groups = append(out.Groups, metrics.Group{ID: k.Group, Name: "Allgemein", En: metrics.Words{"name": "General"}})
		}
		// Bounds of the catalog first; Lumantic's single target and limit hold where the catalog has none of that kind.
		k.Bounds = append([]metrics.Bound{}, company.Bounds[ck.ID]...)
		for _, b := range k.Bounds {
			if b.Kind == "ziel" {
				o["target"] = FromSource
			} else {
				o["limit"] = FromSource
			}
		}
		if o["target"] == FromSource {
			k.Target = nil
		}
		if o["limit"] == FromSource {
			k.Limit = nil
		}
		if k.Monthly.Table == "" || k.Monthly.Value == "" {
			problems = append(problems, fmt.Sprintf("%s: Im Fachkatalog fehlen Tabelle oder Wertspalte.", k.Name))
		} else if missing := k.Missing(cat); len(missing) > 0 {
			problems = append(problems, fmt.Sprintf("%s: im Goldlayer fehlt %s.", k.Name, strings.Join(missing, ", ")))
		}
		merged = append(merged, k)
	}
	for _, k := range out.KPIs {
		if !taken[k.ID] {
			merged = append(merged, k)
		}
	}
	out.KPIs = merged
	// Words: the catalog's first, Lumantic's for the others.
	known := map[string]bool{}
	terms := append([]metrics.Term{}, company.Terms...)
	for _, t := range terms {
		known[strings.ToLower(t.Term)] = true
	}
	for _, t := range out.Terms {
		if !known[strings.ToLower(t.Term)] {
			terms = append(terms, t)
		}
	}
	out.Terms = terms
	return out, problems
}

// fillFrom takes the fields a full Lumantic definition has and the catalog not.
func fillFrom(k *metrics.Def, d metrics.Def, o map[string]string) {
	str := func(field string, to *string, v string) {
		if *to == "" && v != "" {
			*to, o[field] = v, FromLumantic
		}
	}
	str("desc", &k.Desc, d.Desc)
	str("formula", &k.Formula, d.Formula)
	str("owner", &k.Owner, d.Owner)
	str("unit", &k.Unit, d.Unit)
	str("kind", &k.Kind, d.Kind)
	str("group", &k.Group, d.Group)
	if o["dir"] == "" {
		k.Dir, o["dir"] = d.Dir, FromLumantic
	}
	if o["source"] == "" && d.Monthly.Table != "" {
		k.Monthly, o["source"] = d.Monthly, FromLumantic
	}
	if k.Parts == nil && d.Parts != nil {
		k.Parts, o["parts"] = d.Parts, FromLumantic
	}
	if d.Target != nil {
		k.Target, o["target"] = d.Target, FromLumantic
	}
	if d.Limit != nil {
		k.Limit, o["limit"] = d.Limit, FromLumantic
	}
	k.Long, k.Short, k.Dec, k.TargetName, k.LimitName = d.Long, d.Short, d.Dec, d.TargetName, d.LimitName
	for f, v := range d.En {
		if k.En[f] == "" {
			k.En = k.En.With(f, v)
		}
	}
	k.Hidden, k.Season, k.Daily, k.Access = d.Hidden, d.Season, d.Daily, d.Access
	k.TargetPer, k.Phasing, k.Profile = d.TargetPer, d.Phasing, d.Profile
	if d.Phasing != "" || len(d.Profile) > 0 {
		o["phasing"] = FromLumantic
	}
}

// addExtra takes Lumantic's additions where the catalog leaves a field open.
func addExtra(k *metrics.Def, ex metrics.Extra, o map[string]string) {
	str := func(field string, to *string, v string) {
		if v != "" && o[field] != FromSource {
			*to, o[field] = v, FromLumantic
		}
	}
	str("desc", &k.Desc, ex.Desc)
	str("formula", &k.Formula, ex.Formula)
	str("owner", &k.Owner, ex.Owner)
	for f, v := range ex.En {
		if o[f] != FromSource {
			k.En = k.En.With(f, v)
		}
	}
	str("unit", &k.Unit, ex.Unit)
	str("kind", &k.Kind, ex.Kind)
	if ex.Dir != nil && o["dir"] != FromSource {
		k.Dir, o["dir"] = *ex.Dir, FromLumantic
	}
	if ex.Dec != nil {
		k.Dec = *ex.Dec
	}
	if ex.Short != "" {
		k.Short = ex.Short
	}
	if ex.Target != nil {
		k.Target, o["target"] = ex.Target, FromLumantic
	}
	if ex.Limit != nil {
		k.Limit, o["limit"] = ex.Limit, FromLumantic
	}
	if ex.TargetName != "" {
		k.TargetName = ex.TargetName
	}
	if ex.TargetPer != "" {
		k.TargetPer = ex.TargetPer
	}
	if ex.Phasing != "" {
		k.Phasing, o["phasing"] = ex.Phasing, FromLumantic
	}
	if ex.LimitName != "" {
		k.LimitName = ex.LimitName
	}
	if len(ex.Access) > 0 {
		k.Access = ex.Access
	}
	k.Hidden = k.Hidden || ex.Hidden
}

// guess fills what is still open from the source: a column's comment, the
// unit from its name, the kind from the unit. All of it is a suggestion.
func guess(k *metrics.Def, cat *catalog.Catalog, o map[string]string) {
	var col *catalog.Column
	if cat != nil {
		if t := cat.Table(k.Monthly.Table); t != nil {
			col = t.Column(k.Monthly.Value)
		}
	}
	if k.Desc == "" && col != nil && col.Desc != "" {
		k.Desc, o["desc"] = col.Desc, FromSource // the source's own comment on the column
	}
	if k.Unit == "" {
		k.Unit, o["unit"] = UnitOfColumn(k.Monthly.Value), Guessed
	}
	if k.Kind == "" {
		k.Kind, o["kind"] = KindOf(k.Unit, k.Monthly.Value), Guessed
	}
	if o["dir"] == "" {
		k.Dir, o["dir"] = 0, Guessed
	}
	if k.Group == "" {
		k.Group, o["group"] = "allgemein", Guessed
	}
	if k.Short == "" {
		k.Short = k.Name
	}
	if k.Long == "" {
		k.Long = k.Name
	}
	// In English the short and the long name are the English name where none is given, not the German one.
	for _, f := range []string{"short", "long"} {
		if k.En[f] == "" {
			k.En = k.En.With(f, k.En["name"])
		}
	}
	if k.Dec == 0 && k.Unit == "%" {
		k.Dec = 1
	}
}

// UnitOfColumn guesses a unit from a column name: _pct is percent, _mio
// millions of CHF, _stk pieces, _tage days, _h hours.
func UnitOfColumn(col string) string {
	c := strings.ToLower(col)
	switch {
	case hasAny(c, "_pct", "_quote", "_rate", "_ratio", "_marge", "_prozent"):
		return "%"
	case hasAny(c, "_mrd"):
		return "Mrd"
	case hasAny(c, "_mio", "_chf"):
		return "Mio"
	case hasAny(c, "_tsd"):
		return "Tsd"
	case hasAny(c, "_stk", "_stueck", "_anzahl", "_pcs"):
		return "Stk"
	case hasAny(c, "_tage", "_days"):
		return "Tage"
	case hasAny(c, "_h", "_std", "_stunden"):
		return "h"
	}
	return "Zahl"
}

// KindOf guesses whether a figure is a balance (stock) or adds up over the
// month (flow). Rates and days are balances; pieces, hours and money that
// names a movement add up.
func KindOf(unit, col string) string {
	c := strings.ToLower(col)
	switch {
	case unit == "%" || unit == "Tage":
		return "stock"
	case unit == "Stk" || unit == "h":
		return "flow"
	case hasAny(c, "umsatz", "ertrag", "aufwand", "kosten", "eingang", "ausgang", "zufluss", "abfluss", "neugeld"):
		return "flow"
	}
	return "stock"
}

func hasAny(s string, parts ...string) bool {
	for _, p := range parts {
		if strings.HasSuffix(s, p) || strings.Contains(s, p+"_") {
			return true
		}
	}
	return false
}

// unitFrom reads a unit as people write it in a catalog.
func unitFrom(s string) string {
	t := strings.ToLower(strings.TrimSpace(s))
	switch {
	case t == "":
		return ""
	case t == "%" || strings.Contains(t, "prozent") || strings.Contains(t, "percent"):
		return "%"
	case strings.Contains(t, "mrd"):
		return "Mrd"
	case strings.Contains(t, "mio"):
		return "Mio"
	case strings.Contains(t, "tsd") || strings.Contains(t, "tausend"):
		return "Tsd"
	case strings.Contains(t, "stück") || strings.Contains(t, "stueck") || strings.Contains(t, "stk") || t == "pcs":
		return "Stk"
	case strings.HasPrefix(t, "tag") || t == "days" || t == "d":
		return "Tage"
	case t == "h" || strings.HasPrefix(t, "stunde") || t == "std":
		return "h"
	case t == "zahl" || t == "anzahl" || t == "#":
		return "Zahl"
	}
	return ""
}

func kindFrom(s string) string {
	switch t := strings.ToLower(strings.TrimSpace(s)); {
	case strings.HasPrefix(t, "bestand") || t == "stock" || strings.HasPrefix(t, "stichtag"):
		return "stock"
	case strings.HasPrefix(t, "fluss") || t == "flow" || strings.HasPrefix(t, "summe") || strings.HasPrefix(t, "bewegung"):
		return "flow"
	case strings.HasPrefix(t, "durchschnitt") || strings.HasPrefix(t, "mittel") || t == "avg" || t == "average" || t == "ø":
		return "avg"
	case strings.HasPrefix(t, "verhältnis") || strings.HasPrefix(t, "verhaeltnis") || strings.HasPrefix(t, "quote") || t == "ratio":
		return "ratio"
	}
	return ""
}

// perFrom reads what time a target covers: «Jahr» for a budget, «Monat».
func perFrom(s string) string {
	switch t := strings.ToLower(strings.TrimSpace(s)); {
	case strings.HasPrefix(t, "jahr") || strings.HasPrefix(t, "jähr") || t == "year" || t == "annual":
		return "jahr"
	case strings.HasPrefix(t, "monat") || t == "month" || t == "monthly":
		return "monat"
	}
	return ""
}

func dirFrom(s string) (int, bool) {
	switch t := strings.ToLower(strings.TrimSpace(s)); {
	case t == "1" || t == "+1" || strings.HasPrefix(t, "hoch") || strings.HasPrefix(t, "höher") || strings.HasPrefix(t, "hoeher") || strings.HasPrefix(t, "steigend") || t == "up":
		return 1, true
	case t == "-1" || strings.HasPrefix(t, "tief") || strings.HasPrefix(t, "niedrig") || strings.HasPrefix(t, "fallend") || t == "down":
		return -1, true
	case t == "0" || strings.HasPrefix(t, "neutral"):
		return 0, true
	}
	return 0, false
}

func boundKind(s string) string {
	switch t := strings.ToLower(strings.TrimSpace(s)); {
	case strings.HasPrefix(t, "ziel") || t == "target":
		return "ziel"
	case strings.HasPrefix(t, "grenze") || strings.HasPrefix(t, "limit") || strings.HasPrefix(t, "minimum") || strings.HasPrefix(t, "maximum"):
		return "grenze"
	}
	return ""
}

var (
	dateRe  = regexp.MustCompile(`^\d{4}-\d{2}(-\d{2})?`)
	listSep = regexp.MustCompile(`[;,|]`)
)

// dateOf keeps the YYYY-MM-DD of a date as databases print it.
func dateOf(s string) string { return dateRe.FindString(strings.TrimSpace(s)) }

func parseNum(s string) (float64, bool) {
	var v float64
	_, err := fmt.Sscanf(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(s), "’", ""), "'", ""), "%g", &v)
	return v, err == nil
}

func str(r adapter.Row, key string) string {
	switch v := r[key].(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strings.TrimSpace(fmt.Sprint(v))
	case int64:
		return fmt.Sprint(v)
	}
	return ""
}

var idRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// slug keeps an id as the catalog writes it when it is a plain one
// (ebit_marge), so Lumantic's additions find it; anything else becomes a slug.
func slug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if idRe.MatchString(s) && len(s) <= 40 {
		return s
	}
	return metrics.Slug(s)
}

// Contract lists the contract's tables a catalog holds, for the Sternkatalog.
func Contract(cat *catalog.Catalog) []string {
	k, b, t := contract(cat)
	var out []string
	for _, n := range []string{k, b, t} {
		if n != "" {
			out = append(out, n)
		}
	}
	sort.Strings(out)
	return out
}
