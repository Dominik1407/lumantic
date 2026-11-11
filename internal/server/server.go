// Package server exposes Lumantic over a small JSON API and serves the UI.
// A Kosmos is one room over one data source, with its own key figures. There is
// always a first one; the settings can add more. Sources, definitions and
// Lumina can all change while the server runs, so every Kosmos is an immutable
// snapshot that is swapped as a whole behind one lock.
package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"lumantic/internal/adapter"
	"lumantic/internal/ai"
	"lumantic/internal/catalog"
	"lumantic/internal/config"
	"lumantic/internal/lumina"
	"lumantic/internal/metrics"
	"lumantic/internal/source"
	"lumantic/internal/store"
)

type Server struct {
	Store  *store.Store
	Config *config.Manager
	UI     fs.FS
	// NewLumina builds Lumina from the AI settings; nil means Claude. Tests set a fake.
	NewLumina func(ai.Settings) ai.Lumina
	// BuildSource builds the data source; nil means source.Build. secret reads
	// the secrets of the Kosmos at hand by key.
	BuildSource func(d config.Data, secret func(key string) string) (adapter.Adapter, error)

	mu  sync.RWMutex
	ks  map[string]*kosmos // every Kosmos by id; never changed in place, only replaced
	lum ai.Lumina          // nil when the AI is off or has no token
	tr  lumina.Translator

	edit sync.Mutex // one settings or key figure change at a time

	// Now is the clock of the schedule; nil means time.Now. Tests set it.
	Now  func() time.Time
	runs runs           // reads under way, schedules, looks at files (refresh.go)
	hub  hub            // open pages waiting for new figures
	bg   sync.WaitGroup // reads in the background
}

// kosmos is what the server holds of one room: its source, its key figure
// definitions and what was last read from the source.
type kosmos struct {
	ad          adapter.Adapter
	sourceErr   error // the source could not be built or read
	defs        *metrics.Config
	defsErr     error // the key figure file could not be read
	cat         *catalog.Catalog
	weeks       []string
	figures     *metrics.Data
	figuresErr  error
	refreshedAt time.Time
	by          string        // what started the last read: start, hand, anstoss, zeitplan, aenderung
	took        time.Duration // how long it took
	sum         string        // fingerprint of the figures, to tell whether a read brought news
}

// room is what the settings say about one Kosmos.
type room struct {
	id      string
	data    config.Data    // as used: environment applied (first Kosmos), DuckDB program inherited (the others)
	metrics string         // key figure file; "" = built-in ALCO (first Kosmos) or none yet (the others)
	refresh config.Refresh // when it is read again by itself
	ownPlan bool           // the schedule is written down, not the usual one for its source
}

// roomsOf lists the Kosmen of a config, the first one first. eff is that config
// with the environment applied.
func roomsOf(eff config.Config) []room {
	out := []room{{id: config.MainID, data: eff.Data, metrics: eff.Metrics, refresh: config.RefreshOf(eff.Data, eff.Refresh), ownPlan: eff.Refresh != nil}}
	for _, k := range eff.Kosmen {
		d := k.Data
		if d.DuckDB == "" {
			d.DuckDB = eff.Data.DuckDB
		}
		out = append(out, room{id: k.ID, data: d, metrics: k.Metrics, refresh: config.RefreshOf(k.Data, k.Refresh), ownPlan: k.Refresh != nil})
	}
	return out
}

func (s *Server) rooms() []room { return roomsOf(s.Config.Effective()) }

func (s *Server) room(id string) (room, bool) {
	for _, rm := range s.rooms() {
		if rm.id == id {
			return rm, true
		}
	}
	return room{}, false
}

// Start builds every Kosmos and Lumina from the settings and reads the gold
// layers once. Problems are kept in the status, so the app still starts and
// can be set up from its settings.
func (s *Server) Start(ctx context.Context) {
	s.rebuildAI()
	rooms := s.rooms()
	built := make([]*kosmos, len(rooms))
	var wg sync.WaitGroup
	for i, rm := range rooms {
		wg.Add(1)
		go func(i int, rm room) {
			defer wg.Done()
			defs, defsErr := defsFor(rm)
			if defsErr != nil {
				log.Printf("Kennzahlen-Datei von %s nicht lesbar: %v", rm.id, defsErr)
			}
			built[i] = s.read(ctx, rm, defs, defsErr)
			built[i].by = byStart
			if err := built[i].sourceErr; err != nil {
				log.Printf("Datenquelle von %s nicht lesbar: %v", rm.id, err)
			}
		}(i, rm)
	}
	wg.Wait()
	s.mu.Lock()
	s.ks = map[string]*kosmos{}
	for i, rm := range rooms {
		s.ks[rm.id] = built[i]
	}
	s.mu.Unlock()
}

// defsFor reads a Kosmos's key figure definitions. Without a file the first
// Kosmos has the built-in ALCO figures, any other starts with none.
func defsFor(rm room) (*metrics.Config, error) {
	if rm.metrics == "" && rm.id != config.MainID {
		return &metrics.Config{Title: rm.data.Name, Source: rm.data.Name, Groups: []metrics.Group{}, KPIs: []metrics.Def{}}, nil
	}
	return metrics.LoadFile(rm.metrics)
}

// build creates the data source of Kosmos id. A Kosmos without its own DuckDB
// program uses the one of the first. given holds secrets sent along with a
// request (a connection test, a new Kosmos): they are used, not stored.
func (s *Server) build(id string, d config.Data, given map[string]string) (adapter.Adapter, error) {
	if d.DuckDB == "" {
		d.DuckDB = s.Config.Effective().Data.DuckDB
	}
	secret := func(key string) string {
		if !config.PerKosmos(key) {
			v, _, _ := s.Config.Secret(key)
			return v
		}
		if v := strings.TrimSpace(given[key]); v != "" {
			return v
		}
		v, _, _ := s.Config.Secret(config.KosmosKey(key, id))
		return v
	}
	if s.BuildSource != nil {
		return s.BuildSource(d, secret)
	}
	return source.Build(d, secret)
}

// loaded is everything read from one source in one go.
type loaded struct {
	cat        *catalog.Catalog
	weeks      []string
	figures    *metrics.Data
	figuresErr error
	err        error // the source itself failed
	at         time.Time
}

func emptyCatalog(name string) *catalog.Catalog {
	return &catalog.Catalog{Source: name, Dialect: "duckdb", Tables: []catalog.Table{}}
}

func load(ctx context.Context, ad adapter.Adapter, defs *metrics.Config, defsErr error, name string) loaded {
	l := loaded{at: time.Now().UTC()}
	cat, err := ad.Describe(ctx)
	if err != nil {
		l.cat, l.err, l.figuresErr = emptyCatalog(name), err, err
		return l
	}
	l.cat = cat
	// The days with data feed the first board only, which speaks DuckDB. On a
	// warehouse this query would scan every table, so it is left out there.
	var parts []string
	for _, t := range cat.Tables {
		if ad.Dialect() != "duckdb" {
			break
		}
		if tc := t.TimeColumn(); tc != nil {
			parts = append(parts, "SELECT DISTINCT CAST("+adapter.QuoteIdent(tc.Name)+" AS DATE) AS t FROM "+adapter.QuoteTable(t.Name))
		}
	}
	if len(parts) > 0 {
		if rows, err := ad.Query(ctx, "SELECT DISTINCT t FROM ("+strings.Join(parts, " UNION ")+") ORDER BY 1"); err == nil {
			for _, r := range rows {
				l.weeks = append(l.weeks, adapter.String(r, "t"))
			}
		} else {
			log.Printf("Zeitachse nicht lesbar: %v", err)
		}
	}
	switch {
	case defsErr != nil:
		l.figuresErr = defsErr
	case defs == nil:
		l.figuresErr = errNoFigures
	default:
		l.figures, l.figuresErr = metrics.Load(ctx, ad, cat, defs)
		if l.figuresErr != nil && len(defs.KPIs) > 0 {
			log.Printf("Kennzahlen nicht geladen: %v", l.figuresErr)
		}
	}
	return l
}

type plainError string

func (e plainError) Error() string { return string(e) }

const (
	errNoFigures = plainError("Keine Kennzahlen definiert.")
	errNoSource  = plainError("Die Datenquelle ist noch nicht gelesen.")
	errNoKosmos  = plainError("Diesen Kosmos gibt es nicht.")
)

// with returns a copy of k that holds what load read from ad.
func (k *kosmos) with(ad adapter.Adapter, l loaded) *kosmos {
	n := *k
	n.ad, n.sourceErr = ad, l.err
	n.cat, n.weeks, n.figures, n.figuresErr, n.refreshedAt = l.cat, l.weeks, l.figures, l.figuresErr, l.at
	n.by, n.took, n.sum = byHand, 0, sumOf(l.figures)
	return &n
}

// read builds a Kosmos's source and reads it. A source that cannot be built is
// kept as an unavailable one, so the Kosmos still shows up with its error.
func (s *Server) read(ctx context.Context, rm room, defs *metrics.Config, defsErr error) *kosmos {
	k := &kosmos{defs: defs, defsErr: defsErr}
	ad, err := s.build(rm.id, rm.data, nil)
	if err != nil {
		return k.with(adapter.Unavailable{Err: err}, loaded{cat: emptyCatalog(rm.data.Name), err: err, figuresErr: err, at: time.Now().UTC()})
	}
	return k.with(ad, load(ctx, ad, defs, defsErr, rm.data.Name))
}

// get returns a Kosmos by id, nil if there is none.
func (s *Server) get(id string) *kosmos {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ks[id]
}

func (s *Server) put(id string, k *kosmos) {
	s.mu.Lock()
	s.ks[id] = k
	s.mu.Unlock()
}

// pick finds the Kosmos a request names with ?k= (none means the first). For an
// unknown one it answers 404 itself and returns nil.
func (s *Server) pick(w http.ResponseWriter, r *http.Request) (string, *kosmos) {
	id := r.URL.Query().Get("k")
	if id == "" {
		id = config.MainID
	}
	k := s.get(id)
	if k == nil {
		fail(w, 404, errNoKosmos.Error())
		return "", nil
	}
	return id, k
}

// reload builds a Kosmos's source from the settings again and reads it; its
// key figure definitions stay. by says what started it. Use readNow or
// readSoon (refresh.go), which keep to one read at a time.
func (s *Server) reload(ctx context.Context, id, by string) error {
	rm, ok := s.room(id)
	cur := s.get(id)
	if !ok || cur == nil {
		return errNoKosmos
	}
	start := time.Now()
	next := s.read(ctx, rm, cur.defs, cur.defsErr)
	next.by, next.took = by, time.Since(start)
	s.put(id, next)
	return next.sourceErr
}

// Refresh reloads the catalog and the figures of the first Kosmos.
func (s *Server) Refresh(ctx context.Context) error { return s.readNow(ctx, config.MainID, byHand) }

// rebuildAI makes Lumina from the current settings and token.
func (s *Server) rebuildAI() {
	eff := s.Config.Effective()
	tok, st, envName := s.Config.Secret(config.AnthropicToken)
	var lum ai.Lumina
	var tr lumina.Translator = lumina.Offline{}
	if eff.AI.Enabled && st.Set {
		set := ai.Settings{Model: eff.AI.Model, BaseURL: eff.AI.BaseURL, Token: tok, AuthToken: envName == "ANTHROPIC_AUTH_TOKEN"}
		if s.NewLumina != nil {
			lum = s.NewLumina(set)
		} else {
			c := ai.NewClaude(set)
			lum, tr = c, lumina.NewClaude(c.Client(), eff.AI.Model)
		}
	}
	s.mu.Lock()
	s.lum, s.tr = lum, tr
	s.mu.Unlock()
}

// The first board (legacy.go) works on the first Kosmos.
func (s *Server) adapter() adapter.Adapter {
	if k := s.get(config.MainID); k != nil && k.ad != nil {
		return k.ad
	}
	return adapter.Unavailable{Err: errNoSource}
}

func (s *Server) translator() lumina.Translator {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.tr == nil {
		return lumina.Offline{}
	}
	return s.tr
}

func (s *Server) catalog() (*catalog.Catalog, []string) {
	if k := s.get(config.MainID); k != nil && k.cat != nil {
		return k.cat, k.weeks
	}
	return emptyCatalog(""), nil
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	// Kosmos. Everything about one Kosmos takes ?k=<id>; without it the first is meant.
	mux.HandleFunc("GET /api/kosmen", s.getKosmen)
	mux.HandleFunc("POST /api/kosmen", s.addKosmos)
	mux.HandleFunc("DELETE /api/kosmen/{id}", s.deleteKosmos)
	mux.HandleFunc("GET /api/metrics", s.getMetrics)
	mux.HandleFunc("GET /api/workspace", s.getWorkspace)
	mux.HandleFunc("PUT /api/workspace", s.putWorkspace)
	mux.HandleFunc("GET /api/catalog", s.getCatalog)
	mux.HandleFunc("POST /api/refresh", s.postRefresh)
	mux.HandleFunc("GET /api/refresh", s.getRefresh)
	mux.HandleFunc("POST /api/refresh/token", s.postRefreshToken)
	mux.HandleFunc("DELETE /api/refresh/token", s.deleteRefreshToken)
	mux.HandleFunc("GET /api/events", s.events)
	mux.HandleFunc("GET /api/settings", s.getSettings)
	mux.HandleFunc("PUT /api/settings", s.putSettings)
	mux.HandleFunc("POST /api/settings/data/test", s.testData)
	mux.HandleFunc("PUT /api/settings/secret", s.putSecret)
	mux.HandleFunc("POST /api/settings/ai/test", s.testAI)
	mux.HandleFunc("GET /api/kpis", s.getKPIs)
	mux.HandleFunc("POST /api/kpis", s.addKPI)
	mux.HandleFunc("PUT /api/kpis/{id}", s.updateKPI)
	mux.HandleFunc("DELETE /api/kpis/{id}", s.deleteKPI)
	mux.HandleFunc("POST /api/lumina/ask", s.askLumina)
	mux.Handle("GET /brand/", http.HandlerFunc(s.brandFile))
	// The first board (cards and notes); kept for scripts that still use it.
	mux.HandleFunc("GET /api/meta", s.meta)
	mux.HandleFunc("POST /api/catalog/refresh", s.refreshCatalog)
	mux.HandleFunc("GET /api/board", s.board)
	mux.HandleFunc("GET /api/suggestions", s.suggestions)
	mux.HandleFunc("POST /api/ask", s.ask)
	mux.HandleFunc("POST /api/brief", s.brief)
	mux.HandleFunc("POST /api/cards", s.addCard)
	mux.HandleFunc("PATCH /api/cards/{id}", s.setRule)
	mux.HandleFunc("DELETE /api/cards/{id}", s.removeCard)
	mux.HandleFunc("POST /api/reset", s.reset)
	if s.UI != nil {
		mux.Handle("/", http.FileServerFS(s.UI))
	}
	return logRequests(guard(mux))
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	return dec.Decode(v)
}

func (s *Server) getMetrics(w http.ResponseWriter, r *http.Request) {
	_, k := s.pick(w, r)
	if k == nil {
		return
	}
	if k.figures == nil {
		msg := "Keine Kennzahlen definiert."
		if k.figuresErr != nil {
			msg = k.figuresErr.Error()
		}
		fail(w, 503, "Die Kennzahlen sind nicht verfügbar: "+msg)
		return
	}
	writeJSON(w, 200, k.figures)
}

// The first Kosmos keeps the workspace document it always had (its pages and
// the personal settings); every other Kosmos has a document of its own.
func (s *Server) getWorkspace(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if id == config.MainID {
		w.Write(s.Store.Workspace())
		return
	}
	w.Write(s.Store.WorkspaceOf(id))
}

func (s *Server) putWorkspace(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	var raw json.RawMessage
	if err := readJSON(r, &raw); err != nil {
		fail(w, 400, "Ungültiger Arbeitsbereich.")
		return
	}
	var err error
	if id == config.MainID {
		err = s.Store.SetWorkspace(raw)
	} else {
		err = s.Store.SetWorkspaceOf(id, raw)
	}
	if err != nil {
		fail(w, 400, err.Error())
		return
	}
	w.WriteHeader(204)
}

func (s *Server) getCatalog(w http.ResponseWriter, r *http.Request) {
	_, k := s.pick(w, r)
	if k == nil {
		return
	}
	writeJSON(w, 200, k.cat)
}
