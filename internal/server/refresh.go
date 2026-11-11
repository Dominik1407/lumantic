package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/metrics"
)

// A Kosmos is read again when a loading job says so (POST /api/refresh with
// the Kosmos's refresh token), at the times of its schedule, when its files
// change, or by hand. One read at a time per Kosmos: whoever asks during a read
// gets one more read after it, never a pile. Opening a page never asks the
// database. Open pages hear about new figures over GET /api/events.

// What started a read.
const (
	byStart    = "start"
	byHand     = "hand"
	byTrigger  = "anstoss"
	bySchedule = "zeitplan"
	byChange   = "aenderung"
)

// readTimeout bounds a read in the background; a warehouse may first have to wake.
const readTimeout = 5 * time.Minute

// runs is the bookkeeping of reads, schedules and looks at files.
type runs struct {
	mu     sync.Mutex
	locks  map[string]*sync.Mutex // one read at a time per Kosmos
	queued map[string]bool        // a background read waits for its turn
	busy   map[string]bool        // a read is under way
	marks  map[string]string      // the last change mark seen per Kosmos
	looked map[string]time.Time   // when its files were last looked at
	ticked time.Time              // the last tick of the schedule
}

func (r *runs) init() {
	if r.locks == nil {
		r.locks, r.queued, r.busy = map[string]*sync.Mutex{}, map[string]bool{}, map[string]bool{}
		r.marks, r.looked = map[string]string{}, map[string]time.Time{}
	}
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Server) lockOf(id string) *sync.Mutex {
	s.runs.mu.Lock()
	defer s.runs.mu.Unlock()
	s.runs.init()
	l := s.runs.locks[id]
	if l == nil {
		l = &sync.Mutex{}
		s.runs.locks[id] = l
	}
	return l
}

func (s *Server) isBusy(id string) bool {
	s.runs.mu.Lock()
	defer s.runs.mu.Unlock()
	return s.runs.busy[id] || s.runs.queued[id]
}

// readNow reads Kosmos id again and waits for it.
func (s *Server) readNow(ctx context.Context, id, by string) error {
	l := s.lockOf(id)
	l.Lock()
	defer l.Unlock()
	return s.readAndTell(ctx, id, by)
}

// readSoon reads Kosmos id again in the background. It answers false when a
// read is already waiting for its turn: that one will see the new data too.
func (s *Server) readSoon(id, by string) bool {
	s.runs.mu.Lock()
	s.runs.init()
	if s.runs.queued[id] {
		s.runs.mu.Unlock()
		return false
	}
	s.runs.queued[id] = true
	s.runs.mu.Unlock()
	s.bg.Add(1)
	go func() {
		defer s.bg.Done()
		l := s.lockOf(id)
		l.Lock()
		defer l.Unlock()
		s.runs.mu.Lock()
		s.runs.queued[id] = false
		s.runs.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
		defer cancel()
		if err := s.readAndTell(ctx, id, by); err != nil && !errors.Is(err, errNoKosmos) {
			log.Printf("Kosmos %s neu lesen (%s): %v", id, by, err)
		}
	}()
	return true
}

// readAndTell reads, notes the new change mark and tells open pages.
func (s *Server) readAndTell(ctx context.Context, id, by string) error {
	s.runs.mu.Lock()
	s.runs.init()
	s.runs.busy[id] = true
	s.runs.mu.Unlock()
	defer func() {
		s.runs.mu.Lock()
		s.runs.busy[id] = false
		s.runs.mu.Unlock()
	}()
	before := s.get(id)
	err := s.reload(ctx, id, by)
	after := s.get(id)
	if after == nil {
		return err
	}
	// What was just read is the state of the files now; no second read for the same change.
	if w, ok := after.ad.(adapter.Watcher); ok {
		if mark, merr := w.Mark(ctx); merr == nil {
			s.runs.mu.Lock()
			s.runs.marks[id] = mark
			s.runs.mu.Unlock()
		}
	}
	s.hub.publish(event{Kosmos: id, OK: after.sourceErr == nil && after.figures != nil,
		Changed: before == nil || before.sum != after.sum, At: after.refreshedAt.Format(time.RFC3339), By: by})
	return err
}

// Schedule reads Kosmen again at the times of their schedules and when their
// files change, until ctx ends. The server reads every Kosmos at start, so a
// time that passed before is not made up for.
func (s *Server) Schedule(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	s.tick(s.now())
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.tick(s.now())
		}
	}
}

// tick starts what is due at now: a time of day that fell between the last
// tick and now, and a look at files whose turn has come.
func (s *Server) tick(now time.Time) {
	s.runs.mu.Lock()
	s.runs.init()
	since := s.runs.ticked
	s.runs.ticked = now
	s.runs.mu.Unlock()
	if since.IsZero() {
		since = now
	}
	for _, rm := range s.rooms() {
		for _, at := range rm.refresh.Daily {
			if due(at, since, now) {
				s.readSoon(rm.id, bySchedule)
				break
			}
		}
		if rm.refresh.Watch > 0 {
			s.look(rm.id, time.Duration(rm.refresh.Watch)*time.Minute, now)
		}
	}
}

// look asks the source of a Kosmos for its change mark and reads it again when
// the mark moved. The first look only notes the mark.
func (s *Server) look(id string, every time.Duration, now time.Time) {
	s.runs.mu.Lock()
	if last, ok := s.runs.looked[id]; ok && now.Sub(last) < every {
		s.runs.mu.Unlock()
		return
	}
	s.runs.looked[id] = now
	s.runs.mu.Unlock()
	k := s.get(id)
	if k == nil {
		return
	}
	w, ok := k.ad.(adapter.Watcher)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	mark, err := w.Mark(ctx)
	cancel()
	if err != nil {
		return
	}
	s.runs.mu.Lock()
	prev := s.runs.marks[id]
	s.runs.marks[id] = mark
	s.runs.mu.Unlock()
	if prev != "" && prev != mark {
		s.readSoon(id, byChange)
	}
}

// clock reads "06:30".
func clock(at string) (h, m int) {
	fmt.Sscanf(at, "%d:%d", &h, &m)
	return
}

// due says whether the time of day at fell into (since, now].
func due(at string, since, now time.Time) bool {
	if !now.After(since) {
		return false
	}
	if now.Sub(since) >= 24*time.Hour {
		return true
	}
	h, m := clock(at)
	for _, d := range []time.Time{since, now} {
		slot := time.Date(d.Year(), d.Month(), d.Day(), h, m, 0, 0, now.Location())
		if slot.After(since) && !slot.After(now) {
			return true
		}
	}
	return false
}

// nextRun is the next time of day after now, "" without any.
func nextRun(daily []string, now time.Time) string {
	var best time.Time
	for _, at := range daily {
		h, m := clock(at)
		slot := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, now.Location())
		if !slot.After(now) {
			slot = slot.AddDate(0, 0, 1)
		}
		if best.IsZero() || slot.Before(best) {
			best = slot
		}
	}
	if best.IsZero() {
		return ""
	}
	return best.Format(time.RFC3339)
}

// sumOf is a fingerprint of the figures, so a read that brought nothing new
// does not ask open pages to reload.
func sumOf(d *metrics.Data) string {
	if d == nil {
		return ""
	}
	raw, _ := json.Marshal(d)
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:8])
}

// ---- the refresh token ----

// newToken makes a refresh token: 32 random bytes, readable in a URL and a header.
func newToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return "lmt_" + base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}

// tokenState is what the settings may show of a Kosmos's refresh token: set or
// not, and its last four characters.
func (s *Server) tokenState(id string) config.SecretStatus {
	v, st, envName := s.Config.Secret(config.KosmosKey(config.RefreshToken, id))
	if v != "" && envName == "" {
		st.Hint, _, _ = strings.Cut(v, ":")
	}
	return st
}

// tokenFits compares a sent token with the stored one in constant time.
func (s *Server) tokenFits(id, tok string) bool {
	v, _, envName := s.Config.Secret(config.KosmosKey(config.RefreshToken, id))
	if v == "" || tok == "" {
		return false
	}
	if envName != "" {
		return subtle.ConstantTimeCompare([]byte(v), []byte(tok)) == 1
	}
	_, hash, ok := strings.Cut(v, ":")
	return ok && subtle.ConstantTimeCompare([]byte(hash), []byte(hashToken(tok))) == 1
}

// sentToken reads the token of a loading job: "Authorization: Bearer <token>",
// or as the password of basic auth, which is what many webhook tools offer.
func sentToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if h == "" {
		return "", false
	}
	if tok, ok := strings.CutPrefix(h, "Bearer "); ok {
		return strings.TrimSpace(tok), true
	}
	if _, pw, ok := r.BasicAuth(); ok {
		return pw, true
	}
	return "", true
}

// ---- endpoints ----

// postRefresh reads a Kosmos again. A loading job sends its token and gets an
// answer at once (202) while the read runs in the background. The settings
// send no token and wait for the read.
func (s *Server) postRefresh(w http.ResponseWriter, r *http.Request) {
	// A loading job is no person: its token alone counts. A page of the app
	// (same-origin) never needs one, even when a proxy in front adds credentials.
	if tok, sent := sentToken(r); sent && r.Header.Get("Sec-Fetch-Site") != "same-origin" {
		id := r.URL.Query().Get("k")
		if id == "" {
			id = config.MainID
		}
		if s.get(id) == nil {
			fail(w, 404, errNoKosmos.Error())
			return
		}
		if !s.tokenFits(id, tok) {
			fail(w, 401, "Der Aktualisierungs-Token passt nicht zu diesem Kosmos.")
			return
		}
		queued := s.readSoon(id, byTrigger)
		writeJSON(w, 202, map[string]any{"kosmos": id, "queued": queued, "status": s.status(id)})
		return
	}
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	// Reading again costs a warehouse time: by hand it is for those who look after the Kosmos.
	if rm, ok := s.room(id); ok && !s.edits(userOf(r), rm) {
		fail(w, 403, "Neu laden dürfen Administratoren und wer die Kennzahlen dieses Kosmos pflegt.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	s.readNow(ctx, id, byHand)
	writeJSON(w, 200, s.status(id))
}

// getRefresh tells a loading job or a person how the last read went and when
// the next one is.
func (s *Server) getRefresh(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	writeJSON(w, 200, s.status(id))
}

// postRefreshToken makes a new refresh token for a Kosmos and shows it once.
func (s *Server) postRefreshToken(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	tok := newToken()
	s.edit.Lock()
	defer s.edit.Unlock()
	_, err := s.Config.SetSecret(config.KosmosKey(config.RefreshToken, id), tok[len(tok)-4:]+":"+hashToken(tok))
	var envErr *config.SecretEnvError
	switch {
	case errors.As(err, &envErr):
		fail(w, 409, err.Error())
		return
	case err != nil:
		fail(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"token": tok, "state": s.tokenState(id)})
}

func (s *Server) deleteRefreshToken(w http.ResponseWriter, r *http.Request) {
	id, k := s.pick(w, r)
	if k == nil {
		return
	}
	s.edit.Lock()
	defer s.edit.Unlock()
	if _, err := s.Config.SetSecret(config.KosmosKey(config.RefreshToken, id), ""); err != nil {
		var envErr *config.SecretEnvError
		if errors.As(err, &envErr) {
			fail(w, 409, err.Error())
			return
		}
		fail(w, 500, err.Error())
		return
	}
	w.WriteHeader(204)
}

// ---- telling open pages ----

// event says that a Kosmos was read again. Changed is false when the figures
// are the same as before.
type event struct {
	Kosmos  string `json:"kosmos"`
	OK      bool   `json:"ok"`
	Changed bool   `json:"changed"`
	At      string `json:"at"`
	By      string `json:"by"`
}

// hub hands events to every open page.
type hub struct {
	mu   sync.Mutex
	subs map[chan event]struct{}
}

func (h *hub) subscribe() (chan event, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs == nil {
		h.subs = map[chan event]struct{}{}
	}
	ch := make(chan event, 8)
	h.subs[ch] = struct{}{}
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
}

// publish never waits: a page that does not keep up misses an event and gets
// the newest figures with the next one.
func (h *hub) publish(e event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default:
		}
	}
}

// events streams the reads of every Kosmos to an open page (server-sent events).
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		fail(w, 500, "Dieser Server kann keine Meldungen senden.")
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no") // a proxy in front must not hold the stream back
	ch, done := s.hub.subscribe()
	defer done()
	u := userOf(r)
	fmt.Fprint(w, "retry: 5000\n\n")
	fl.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case e := <-ch:
			if rm, ok := s.room(e.Kosmos); !ok || !s.sees(u, rm) {
				continue
			}
			raw, _ := json.Marshal(e)
			fmt.Fprintf(w, "event: refresh\ndata: %s\n\n", raw)
			fl.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		}
	}
}
