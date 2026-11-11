package server

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"lumantic/internal/adapter"
	"lumantic/internal/auth"
	"lumantic/internal/config"
	"lumantic/internal/metrics"
)

// Who may do what. The login (internal/auth) says who someone is; the settings
// say which groups see a Kosmos, look after its key figures and change the
// settings. Without a login everyone is the local person and may do it all.
//
// Weg 1: Lumantic reads with its own account and shows each person what their
// groups allow. Weg 2 (rights "source", Snowflake and Databricks): the numbers
// are read in the person's name, so the database's own rights apply; each
// person then has figures of their own, read when they first look and kept
// until the Kosmos is read again.

type userKey struct{}

func (s *Server) login() auth.Authenticator {
	if s.Auth == nil {
		return auth.None{}
	}
	return s.Auth
}

// open says whether nobody signs in: then the local person may do everything.
func (s *Server) open() bool { return s.login().Kind() == "none" }

// userOf is the person a request comes from; the gate put them there.
func userOf(r *http.Request) auth.User {
	if u, ok := r.Context().Value(userKey{}).(auth.User); ok {
		return u
	}
	return auth.Local
}

func (s *Server) isAdmin(u auth.User) bool {
	return s.open() || config.InGroups(u.Groups, s.Config.Effective().Auth.Admins)
}

// sees says whether a person may see a Kosmos. Admins see every Kosmos, so they
// can look after it.
func (s *Server) sees(u auth.User, rm room) bool {
	return s.isAdmin(u) || config.InGroups(u.Groups, rm.access)
}

// edits says whether a person may look after the key figures of a Kosmos:
// admins, and the groups named as its editors.
func (s *Server) edits(u auth.User, rm room) bool {
	return s.isAdmin(u) || (len(rm.editors) > 0 && config.InGroups(u.Groups, rm.editors))
}

// gate lets only signed-in people through, apart from the login's own pages
// and a loading job that brings its refresh token.
func (s *Server) gate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasPrefix(path, "/auth/") || (path == "/api/refresh" && r.Header.Get("Authorization") != "" && r.Header.Get("Sec-Fetch-Site") != "same-origin") {
			next.ServeHTTP(w, r)
			return
		}
		u, ok := s.login().User(r)
		if !ok {
			login := s.login().LoginURL("/")
			switch {
			case strings.HasPrefix(path, "/api/"):
				writeJSON(w, 401, map[string]string{"error": "Bitte zuerst anmelden.", "login": login})
			case login != "" && r.Method == http.MethodGet:
				http.Redirect(w, r, s.login().LoginURL(r.URL.RequestURI()), http.StatusFound)
			default:
				w.Header().Set("Content-Type", "text/plain; charset=utf-8")
				w.WriteHeader(401)
				w.Write([]byte("Die Anmeldung fehlt. Lumantic erwartet sie vom Proxy davor; ruf Lumantic über dessen Adresse auf."))
			}
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, u)))
	})
}

// adminOnly answers 403 for everyone but the admins and says so.
func (s *Server) adminOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.isAdmin(userOf(r)) {
			fail(w, 403, "Das dürfen nur Administratoren ändern.")
			return
		}
		h(w, r)
	}
}

// editorsOnly answers 403 for everyone who may not look after the key figures
// of the Kosmos the request names.
func (s *Server) editorsOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("k")
		if id == "" {
			id = config.MainID
		}
		if rm, ok := s.room(id); ok && !s.edits(userOf(r), rm) {
			fail(w, 403, "Die Kennzahlen dieses Kosmos pflegen andere. Frag einen Administrator.")
			return
		}
		h(w, r)
	}
}

// me tells the page who is signed in and what they may do.
type me struct {
	auth.User
	Admin  bool   `json:"admin"`
	Editor bool   `json:"editor"` // may look after the key figures of the Kosmos at hand
	Login  string `json:"login"`  // none, proxy or oidc
	Logout string `json:"logout"` // where «Abmelden» leads; "" without a login
}

func (s *Server) meOf(r *http.Request, id string) me {
	u := userOf(r)
	m := me{User: u, Admin: s.isAdmin(u), Login: s.login().Kind(), Logout: s.login().LogoutURL()}
	if rm, ok := s.room(id); ok {
		m.Editor = s.edits(u, rm)
	}
	if m.Groups == nil {
		m.Groups = []string{}
	}
	return m
}

func (s *Server) getMe(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("k")
	if id == "" {
		id = config.MainID
	}
	writeJSON(w, 200, s.meOf(r, id))
}

// ---- figures as a person may see them ----

// figuresFor is what one person may see of a Kosmos's figures: in Weg 2 their
// own, read in their name; in Weg 1 the shared ones without the key figures
// their groups may not see.
func (s *Server) figuresFor(r *http.Request, id string, k *kosmos) (*metrics.Data, error) {
	rm, _ := s.room(id)
	u := userOf(r)
	figs, figErr := k.figures, k.figuresErr
	if rm.rights == config.RightsSource {
		figs, figErr = s.viewOf(r, id, k, u)
	}
	if figs == nil {
		if figErr == nil {
			figErr = errNoFigures
		}
		return nil, figErr
	}
	if s.isAdmin(u) || k.merged == nil {
		return figs, nil
	}
	hidden := map[string]bool{}
	for _, d := range k.merged.KPIs {
		if !config.InGroups(u.Groups, d.Access) {
			hidden[d.ID] = true
		}
	}
	if len(hidden) == 0 {
		return figs, nil
	}
	out := *figs
	out.KPIs = nil
	for _, kpi := range figs.KPIs {
		if !hidden[kpi.ID] {
			out.KPIs = append(out.KPIs, kpi)
		}
	}
	return &out, nil
}

// view is one person's figures of a Kosmos read in their name.
type view struct {
	mu      sync.Mutex
	base    time.Time // the read of the Kosmos they belong to
	figures *metrics.Data
	err     error
}

type views struct {
	mu sync.Mutex
	m  map[string]*view
}

func (v *views) of(key string) *view {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.m == nil {
		v.m = map[string]*view{}
	}
	if v.m[key] == nil {
		v.m[key] = &view{}
	}
	return v.m[key]
}

// viewOf reads a Kosmos's figures in the person's name, once per read of the
// Kosmos: a new read (schedule, loading job, by hand) makes the next look
// read again.
func (s *Server) viewOf(r *http.Request, id string, k *kosmos, u auth.User) (*metrics.Data, error) {
	v := s.views.of(id + "|" + u.ID)
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.figures != nil && v.base.Equal(k.refreshedAt) {
		return v.figures, nil
	}
	ctx, cancel := context.WithTimeout(r.Context(), readTimeout)
	defer cancel()
	tok, err := s.login().Token(ctx, r)
	if err != nil {
		return nil, err
	}
	if tok == "" {
		return nil, errors.New("Dieser Kosmos fragt die Datenbank in deinem Namen. Dafür braucht es die Anmeldung über OpenID Connect.")
	}
	ob, ok := k.ad.(adapter.OnBehalf)
	if !ok {
		return nil, errors.New("Diese Datenquelle kann nicht in deinem Namen fragen.")
	}
	ad, err := ob.As(ctx, adapter.Person{ID: u.ID, Token: tok})
	if err != nil {
		return nil, err
	}
	if k.cat == nil || k.merged == nil {
		return nil, errNoFigures
	}
	figs, err := metrics.Load(ctx, ad, k.cat, k.merged)
	if err != nil {
		return nil, err
	}
	v.figures, v.err, v.base = figs, nil, k.refreshedAt
	return figs, nil
}

// ---- the access log ----

// note writes down who signed in and who opened which Kosmos, one JSON line
// each, without any figures. Nothing is written while nobody signs in.
func (s *Server) note(event string, u auth.User, kosmos string) {
	if s.open() || s.AccessLog == "" {
		return
	}
	if event == "kosmos" {
		key := u.ID + "|" + kosmos
		s.noted.mu.Lock()
		if s.noted.at == nil {
			s.noted.at = map[string]time.Time{}
		}
		last, seen := s.noted.at[key]
		now := s.now()
		if seen && now.Sub(last) < 30*time.Minute {
			s.noted.mu.Unlock()
			return
		}
		s.noted.at[key] = now
		s.noted.mu.Unlock()
	}
	line, _ := json.Marshal(map[string]any{"at": s.now().UTC().Format(time.RFC3339), "event": event, "user": u.ID, "name": u.Name, "kosmos": kosmos})
	s.noted.mu.Lock()
	defer s.noted.mu.Unlock()
	f, err := os.OpenFile(s.AccessLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		log.Printf("Zugriffsprotokoll %s: %v", s.AccessLog, err)
		return
	}
	defer f.Close()
	f.Write(append(line, '\n'))
}

// Noted is what the login hands its sign-ins and sign-outs to.
func (s *Server) Noted(event string, u auth.User) { s.note(event, u, "") }

type noted struct {
	mu sync.Mutex
	at map[string]time.Time
}
