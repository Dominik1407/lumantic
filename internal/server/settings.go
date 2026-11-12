package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/metrics"
	"github.com/Dominik1407/lumantic/internal/source"
)

// Status says in numbers whether the gold layer is there.
type Status struct {
	OK          bool   `json:"ok"`
	Error       string `json:"error"`
	Tables      int    `json:"tables"`
	KPIs        int    `json:"kpis"`
	KPIsLoaded  int    `json:"kpisLoaded"`
	Months      int    `json:"months"`
	First       string `json:"first"`
	Last        string `json:"last"`
	RefreshedAt string `json:"refreshedAt"`
	Until       string `json:"until"`      // the newest day (or month) with data
	By          string `json:"by"`         // what started the last read: start, hand, anstoss, zeitplan, aenderung
	Ms          int64  `json:"ms"`         // how long the last read took
	Refreshing  bool   `json:"refreshing"` // a read is under way or waiting
	Next        string `json:"next"`       // the next time on the schedule, "" without one
}

// Status is the data source status of the first Kosmos, as shown in the settings.
func (s *Server) Status() Status { return s.status(config.MainID) }

// status is a Kosmos's status together with its reads: whether one is under
// way and when the schedule brings the next.
func (s *Server) status(id string) Status {
	st := statusOf(s.get(id))
	st.Refreshing = s.isBusy(id)
	if rm, ok := s.room(id); ok {
		st.Next = nextRun(rm.refresh.Daily, s.now())
	}
	return st
}

func statusOf(k *kosmos) Status {
	st := Status{}
	if k == nil {
		st.Error = errNoSource.Error()
		return st
	}
	if k.cat != nil {
		st.Tables = len(k.cat.Tables)
	}
	if k.merged != nil {
		st.KPIs = len(k.merged.KPIs)
	} else if k.defs != nil {
		st.KPIs = len(k.defs.KPIs)
	}
	if !k.refreshedAt.IsZero() {
		st.RefreshedAt = k.refreshedAt.Format(time.RFC3339)
	}
	st.By, st.Ms = k.by, k.took.Milliseconds()
	if f := k.figures; f != nil {
		st.KPIsLoaded, st.Months = len(f.KPIs), len(f.Months)
		if len(f.Months) > 0 {
			st.First, st.Last = f.Months[0], f.Months[len(f.Months)-1]
			st.Until = st.Last
		}
		if len(f.Days) > 0 && f.Days[len(f.Days)-1] > st.Until {
			st.Until = f.Days[len(f.Days)-1]
		}
	}
	switch {
	case k.sourceErr != nil:
		st.Error = "Die Datenquelle ist nicht erreichbar: " + source.Explain(k.sourceErr)
	case k.perPerson && st.KPIs > 0:
		// Weg 2: the figures are read in each person's name when they look.
		st.OK, st.KPIsLoaded = true, st.KPIs
	case k.figures == nil && st.KPIs == 0 && k.defsErr == nil:
		st.Error = "Für diesen Kosmos sind noch keine Kennzahlen definiert."
	case k.figures == nil && k.figuresErr != nil:
		st.Error = "Kennzahlen nicht geladen: " + k.figuresErr.Error()
	case k.figures == nil:
		st.Error = "Kennzahlen nicht geladen."
	default:
		st.OK = true
	}
	return st
}

type windmillView struct {
	config.Windmill
	Token config.SecretStatus `json:"token"`
}

type snowflakeView struct {
	config.Snowflake
	Token config.SecretStatus `json:"token"`
}

type databricksView struct {
	config.Databricks
	Token  config.SecretStatus `json:"token"`
	Secret config.SecretStatus `json:"secret"`
}

type dataView struct {
	Example    bool           `json:"example"` // the examples Lumantic writes itself
	Type       string         `json:"type"`
	Name       string         `json:"name"`
	Path       string         `json:"path"`
	Schema     string         `json:"schema"`
	DuckDB     string         `json:"duckdb"`
	Snowflake  snowflakeView  `json:"snowflake"`
	Databricks databricksView `json:"databricks"`
	Windmill   windmillView   `json:"windmill"`
}

type aiView struct {
	config.AI
	Token  config.SecretStatus `json:"token"`
	Models []config.Model      `json:"models"`
	Ready  bool                `json:"ready"`
}

// kosmosRef says which Kosmos a settings answer is about.
type kosmosRef struct {
	ID    string `json:"id"`
	Main  bool   `json:"main"`  // the first one: cannot be removed
	Count int    `json:"count"` // how many there are
}

// refreshView is when a Kosmos is read again by itself, and whether a loading
// job can ask for it.
type refreshView struct {
	config.Refresh
	Own       bool                `json:"own"`       // written down; otherwise the usual for its source
	Watchable bool                `json:"watchable"` // its files can be watched for changes
	Token     config.SecretStatus `json:"token"`     // the refresh token for loading jobs
}

type settingsView struct {
	Version       string       `json:"version"`
	ConfigPath    string       `json:"configPath"`
	ConfigExists  bool         `json:"configExists"`
	DuckDBBuiltIn bool         `json:"duckdbBuiltIn"` // DuckDB is in the program; a path to the CLI is optional
	ExamplesOnly  bool         `json:"examplesOnly"`  // open without a login, so only the examples
	Locked        []string     `json:"locked"`
	UI            config.UI    `json:"ui"`
	Kosmos        kosmosRef    `json:"kosmos"`
	Data          dataView     `json:"data"`
	Metrics       string       `json:"metrics"`
	Status        Status       `json:"status"`
	Refresh       refreshView  `json:"refresh"`
	Grain         string       `json:"grain"` // the standard raster of the Kosmos
	Me            me           `json:"me"`    // who asks, and what they may change
	AI            aiView       `json:"ai"`
	Brand         config.Brand `json:"brand"`
}

// settingsFor answers the settings as one Kosmos sees them: data, key figure
// file and status are its own, everything else is shared.
func (s *Server) settingsFor(r *http.Request, id string) settingsView {
	eff := s.Config.Effective()
	_, aiTok, _ := s.Config.Secret(config.AnthropicToken)
	_, wmTok, _ := s.Config.Secret(config.WindmillToken)
	brand, _ := config.SanitizeBrand(eff.Brand)
	rooms := roomsOf(eff)
	rm := rooms[0]
	for _, r := range rooms {
		if r.id == id {
			rm = r
		}
	}
	locked := s.Config.Locked()
	if rm.id != config.MainID {
		// Environment variables fix the first Kosmos only. The DuckDB program is shared.
		own := eff.Kosmen[eff.Find(rm.id)].Data.DuckDB
		kept := locked[:0:0]
		for _, l := range locked {
			if (!strings.HasPrefix(l, "data.") && l != "metrics") || (l == "data.duckdb" && own == "") {
				kept = append(kept, l)
			}
		}
		locked = kept
	}
	d := rm.data
	secret := func(key string) config.SecretStatus {
		_, st, _ := s.Config.Secret(config.KosmosKey(key, rm.id))
		return st
	}
	// A warehouse the Kosmos does not use yet shows the usual way to sign in.
	sf, db := d.Snowflake, d.Databricks
	if sf.Auth == "" {
		sf.Auth = "keypair"
	}
	if db.Auth == "" {
		db.Auth = "oauth"
	}
	v := settingsView{
		Version:       config.Version,
		ConfigPath:    s.Config.Path(),
		ConfigExists:  s.Config.Exists(),
		Locked:        locked,
		UI:            eff.UI,
		Kosmos:        kosmosRef{ID: rm.id, Main: rm.id == config.MainID, Count: len(rooms)},
		DuckDBBuiltIn: adapter.BuiltIn(), ExamplesOnly: s.ExamplesOnly,
		Data: dataView{Example: d.Example, Type: d.Type, Name: d.Name, Path: d.Path, Schema: d.Schema, DuckDB: d.DuckDB,
			Snowflake:  snowflakeView{Snowflake: sf, Token: secret(config.SnowflakeToken)},
			Databricks: databricksView{Databricks: db, Token: secret(config.DatabricksToken), Secret: secret(config.DatabricksSecret)},
			Windmill:   windmillView{Windmill: d.Windmill, Token: wmTok}},
		Metrics: rm.metrics,
		Status:  s.status(rm.id),
		Refresh: refreshView{Refresh: rm.refresh, Own: rm.ownPlan, Watchable: config.Watchable(d.Type), Token: s.tokenState(rm.id)},
		Grain:   rm.grain,
		AI:      aiView{AI: eff.AI, Token: aiTok, Models: config.Models, Ready: eff.AI.Enabled && aiTok.Set},
		Brand:   brand,
	}
	v.Me = s.meOf(r, rm.id)
	// Only admins change sources and tokens; the others see what they need to read the status.
	if !v.Me.Admin {
		v.ConfigPath, v.Locked, v.Metrics = "", []string{}, ""
		v.Data = dataView{Type: d.Type, Name: d.Name}
		v.Refresh.Token = config.SecretStatus{}
		v.AI.Token = config.SecretStatus{}
	}
	return v
}

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	writeJSON(w, 200, s.settingsFor(r, id))
}

// httpError carries the status a handler should answer with.
type httpError struct {
	code int
	msg  string
}

func (e *httpError) Error() string { return e.msg }

func failWith(w http.ResponseWriter, err error) {
	var he *httpError
	if errors.As(err, &he) {
		fail(w, he.code, he.msg)
		return
	}
	fail(w, 500, err.Error())
}

// putSettings saves a changed section. A new data source must answer before
// anything is saved; then source, catalog and figures change together.
// With ?k=<id> the "data" section is that Kosmos's source.
func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	var req map[string]json.RawMessage
	if err := readJSON(r, &req); err != nil {
		fail(w, 400, "Ungültige Einstellungen.")
		return
	}
	s.edit.Lock()
	defer s.edit.Unlock()
	if id != config.MainID {
		if raw, ok := req["data"]; ok {
			if err := s.putRoomData(r, id, raw); err != nil {
				failWith(w, err)
				return
			}
		}
		if raw, ok := req["refresh"]; ok {
			if err := s.putRoomRefresh(id, raw); err != nil {
				failWith(w, err)
				return
			}
		}
		if raw, ok := req["grain"]; ok {
			if err := s.putRoomGrain(id, raw); err != nil {
				failWith(w, err)
				return
			}
		}
		delete(req, "data")
		delete(req, "metrics")
		delete(req, "refresh")
		delete(req, "grain")
		if len(req) == 0 {
			writeJSON(w, 200, s.settingsFor(r, id))
			return
		}
	}
	before := s.Config.Effective()
	file := s.Config.File()
	cand, err := s.Config.Merge(req)
	var locked *config.LockedError
	switch {
	case errors.As(err, &locked):
		fail(w, 409, err.Error())
		return
	case err != nil:
		fail(w, 422, err.Error())
		return
	}
	if _, ok := req["brand"]; ok {
		if err := config.ValidateBrand(cand.Brand); err != nil {
			fail(w, 422, err.Error())
			return
		}
	}
	// An example that gets another source is the person's own from then on: no
	// example any more, and the example's definitions go with it.
	if file.Data.Example && config.Moved(file.Data, cand.Data) {
		cand.Data.Example, cand.Metrics = false, ""
	}
	if err := config.Validate(cand); err != nil {
		fail(w, 422, err.Error())
		return
	}
	after := s.Config.EffectiveOf(cand)
	if s.ExamplesOnly {
		b := before
		b.UI, b.Grain = after.UI, after.Grain
		if !reflect.DeepEqual(b, after) {
			fail(w, 403, msgExamplesOnly)
			return
		}
	}
	dataChanged := !reflect.DeepEqual(before.Data, after.Data)
	metricsChanged := before.Metrics != after.Metrics

	main := s.get(config.MainID)
	defs, defsErr := main.defs, main.defsErr
	if metricsChanged {
		if defs, err = metrics.LoadFile(after.Metrics); err != nil {
			fail(w, 422, fmt.Sprintf("Die Kennzahlen-Datei %s lässt sich nicht lesen: %v", after.Metrics, err))
			return
		}
		defsErr = nil
	}
	var fresh *kosmos
	if dataChanged || metricsChanged {
		ad := main.ad
		if dataChanged {
			if ad, err = s.build(config.MainID, after.Data, nil); err != nil {
				fail(w, 422, err.Error())
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		l := load(ctx, ad, defs, defsErr, after.Data.Name, after.Rights != config.RightsSource)
		cancel()
		if dataChanged && l.err != nil {
			fail(w, 422, "Die neue Datenquelle ist nicht erreichbar: "+source.Explain(l.err))
			return
		}
		fresh = (&kosmos{defs: defs, defsErr: defsErr, perPerson: after.Rights == config.RightsSource}).with(ad, l)
	}
	if err := s.Config.Save(cand); err != nil {
		fail(w, 500, err.Error())
		return
	}
	if fresh != nil {
		s.put(config.MainID, fresh)
	}
	if !reflect.DeepEqual(before.AI, after.AI) {
		s.rebuildAI()
	}
	writeJSON(w, 200, s.settingsFor(r, id))
}

// putRoomData changes the data source of a Kosmos beside the first. Like for
// the first, the new source must answer before anything is saved.
func (s *Server) putRoomData(r *http.Request, id string, raw json.RawMessage) error {
	c := s.Config.File()
	i := c.Find(id)
	if i < 0 {
		return &httpError{404, errNoKosmos.Error()}
	}
	before := c.Kosmen[i].Data
	d := before
	if err := json.Unmarshal(raw, &d); err != nil {
		return &httpError{422, "Einstellung data ist ungültig: " + err.Error()}
	}
	config.NormalizeData(&d)
	// The DuckDB program of the first Kosmos is not written down a second time.
	if before.DuckDB == "" && d.DuckDB == s.Config.Effective().Data.DuckDB {
		d.DuckDB = ""
	}
	if d.Name == "" {
		return &httpError{422, "Der Kosmos braucht einen Namen."}
	}
	if err := config.ValidateData(d); err != nil {
		return &httpError{422, err.Error()}
	}
	if reflect.DeepEqual(before, d) {
		return nil
	}
	if s.ExamplesOnly {
		return &httpError{403, msgExamplesOnly}
	}
	cur := s.get(id)
	// An example that gets another source is the person's own from then on.
	if before.Example && config.Moved(before, d) {
		d.Example, c.Kosmen[i].Metrics = false, ""
		defs, _ := defsFor(room{id: id, data: d})
		cur = &kosmos{defs: defs, perPerson: cur.perPerson}
	}
	c.Kosmen[i].Data = d
	ad, err := s.build(id, d, nil)
	if err != nil {
		return &httpError{422, err.Error()}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	rm, _ := s.room(id)
	l := load(ctx, ad, cur.defs, cur.defsErr, d.Name, rm.rights != config.RightsSource)
	cancel()
	if l.err != nil {
		return &httpError{422, "Die neue Datenquelle ist nicht erreichbar: " + source.Explain(l.err)}
	}
	if err := s.Config.Save(c); err != nil {
		return &httpError{500, err.Error()}
	}
	s.put(id, cur.with(ad, l))
	return nil
}

// putRoomRefresh changes when a Kosmos beside the first is read again by itself.
// null goes back to the usual schedule for its source.
func (s *Server) putRoomRefresh(id string, raw json.RawMessage) error {
	c := s.Config.File()
	i := c.Find(id)
	if i < 0 {
		return &httpError{404, errNoKosmos.Error()}
	}
	var r *config.Refresh
	if err := json.Unmarshal(raw, &r); err != nil {
		return &httpError{422, "Einstellung refresh ist ungültig: " + err.Error()}
	}
	c.Kosmen[i].Refresh = r
	config.Normalize(&c)
	if err := config.Validate(c); err != nil {
		return &httpError{422, err.Error()}
	}
	if err := s.Config.Save(c); err != nil {
		return &httpError{500, err.Error()}
	}
	return nil
}

// putRoomGrain changes the standard raster of a Kosmos beside the first. The
// figures stay as they are; the raster travels with GET /api/metrics.
func (s *Server) putRoomGrain(id string, raw json.RawMessage) error {
	c := s.Config.File()
	i := c.Find(id)
	if i < 0 {
		return &httpError{404, errNoKosmos.Error()}
	}
	var g string
	if err := json.Unmarshal(raw, &g); err != nil {
		return &httpError{422, "Einstellung grain ist ungültig: " + err.Error()}
	}
	c.Kosmen[i].Grain = g
	config.Normalize(&c)
	if err := config.Validate(c); err != nil {
		return &httpError{422, err.Error()}
	}
	if err := s.Config.Save(c); err != nil {
		return &httpError{500, err.Error()}
	}
	return nil
}

// testData tries a data source without saving it. The body is the data object
// (or {"data": {...}}); missing fields come from the Kosmos named with ?k=.
func (s *Server) testData(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	var raw map[string]json.RawMessage
	if err := readJSON(r, &raw); err != nil {
		fail(w, 400, "Ungültige Datenquelle.")
		return
	}
	// Tokens typed in for this test come along as "secrets"; they are used, not stored.
	var given map[string]string
	if sec, ok := raw["secrets"]; ok {
		json.Unmarshal(sec, &given)
		delete(raw, "secrets")
	}
	body := raw
	if inner, ok := raw["data"]; ok {
		body = nil
		if err := json.Unmarshal(inner, &body); err != nil {
			fail(w, 400, "Ungültige Datenquelle.")
			return
		}
	}
	rm, _ := s.room(id)
	d := rm.data
	buf, _ := json.Marshal(body)
	if err := json.Unmarshal(buf, &d); err != nil {
		fail(w, 400, "Ungültige Datenquelle.")
		return
	}
	config.NormalizeData(&d)
	type result struct {
		OK     bool               `json:"ok"`
		Error  string             `json:"error"`
		Tables []source.TableInfo `json:"tables"`
	}
	out := result{Tables: []source.TableInfo{}}
	if err := config.ValidateData(d); err != nil {
		out.Error = err.Error()
		writeJSON(w, 200, out)
		return
	}
	ad, err := s.build(id, d, given)
	if err != nil {
		out.Error = err.Error()
		writeJSON(w, 200, out)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	_, tables, err := source.Inspect(ctx, ad)
	switch {
	case err != nil:
		out.Error = source.Explain(err)
	case len(tables) == 0:
		out.Error = "In dieser Quelle gibt es keine Tabellen. Prüf den Pfad und das Schema."
	default:
		out.OK, out.Tables = true, tables
	}
	writeJSON(w, 200, out)
}

func (s *Server) putSecret(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := readJSON(r, &req); err != nil {
		fail(w, 400, "Ungültige Anfrage.")
		return
	}
	// A warehouse token belongs to the Kosmos named with ?k=.
	id := r.URL.Query().Get("k")
	if id == "" {
		id = config.MainID
	}
	if _, ok := s.room(id); !ok {
		fail(w, 404, errNoKosmos.Error())
		return
	}
	key := req.Key
	if config.PerKosmos(key) {
		key = config.KosmosKey(key, id)
	}
	s.edit.Lock()
	defer s.edit.Unlock()
	st, err := s.Config.SetSecret(key, req.Value)
	var envErr *config.SecretEnvError
	switch {
	case errors.As(err, &envErr):
		fail(w, 409, err.Error())
		return
	case err != nil:
		fail(w, 400, err.Error())
		return
	}
	switch req.Key {
	case config.AnthropicToken:
		s.rebuildAI()
	case config.WindmillToken:
		// Every Kosmos on Windmill reads with the new token.
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		for _, rm := range s.rooms() {
			if rm.data.Type == "windmill" {
				s.readNow(ctx, rm.id, byHand)
			}
		}
		cancel()
	case config.SnowflakeToken, config.DatabricksToken, config.DatabricksSecret:
		// The Kosmos reads with its new token, if it is on that warehouse.
		if rm, _ := s.room(id); strings.HasPrefix(req.Key, rm.data.Type) {
			ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
			s.readNow(ctx, id, byHand)
			cancel()
		}
	}
	writeJSON(w, 200, st)
}

func (s *Server) testAI(w http.ResponseWriter, r *http.Request) {
	eff := s.Config.Effective()
	type result struct {
		OK    bool   `json:"ok"`
		Model string `json:"model"`
		Ms    int64  `json:"ms"`
		Error string `json:"error"`
	}
	out := result{Model: eff.AI.Model}
	s.mu.RLock()
	lum := s.lum
	s.mu.RUnlock()
	if lum == nil {
		if !eff.AI.Enabled {
			out.Error = "Die KI ist ausgeschaltet."
		} else {
			out.Error = "Es ist kein API-Token gesetzt."
		}
		writeJSON(w, 200, out)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	start := time.Now()
	err := lum.Test(ctx)
	out.Ms = time.Since(start).Milliseconds()
	if err != nil {
		out.Error = err.Error()
	} else {
		out.OK = true
	}
	writeJSON(w, 200, out)
}
