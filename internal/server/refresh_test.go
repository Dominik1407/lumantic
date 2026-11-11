package server

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Dominik1407/lumantic/internal/adapter"
	"github.com/Dominik1407/lumantic/internal/config"
)

func TestDueAndNext(t *testing.T) {
	at := func(d, h, m, s int) time.Time { return time.Date(2026, 11, d, h, m, s, 0, time.Local) }
	cases := []struct {
		slot        string
		since, now  time.Time
		want        bool
		description string
	}{
		{"06:00", at(11, 5, 59, 40), at(11, 6, 0, 10), true, "the time fell between two ticks"},
		{"06:00", at(11, 6, 0, 10), at(11, 6, 0, 40), false, "already past at the last tick"},
		{"00:10", at(10, 23, 59, 50), at(11, 0, 10, 20), true, "over midnight"},
		{"12:00", at(11, 5, 0, 0), at(11, 5, 0, 30), false, "not yet"},
		{"12:00", at(9, 5, 0, 0), at(11, 5, 0, 0), true, "a long sleep makes up one read"},
		{"06:00", at(11, 6, 0, 0), at(11, 6, 0, 0), false, "no time passed"},
	}
	for _, c := range cases {
		if got := due(c.slot, c.since, c.now); got != c.want {
			t.Errorf("%s: due(%s) = %v", c.description, c.slot, got)
		}
	}
	if got := nextRun([]string{"18:30", "06:00"}, at(11, 12, 0, 0)); got != at(11, 18, 30, 0).Format(time.RFC3339) {
		t.Errorf("next today: %s", got)
	}
	if got := nextRun([]string{"18:30", "06:00"}, at(11, 19, 0, 0)); got != at(12, 6, 0, 0).Format(time.RFC3339) {
		t.Errorf("next tomorrow: %s", got)
	}
	if nextRun(nil, at(11, 1, 0, 0)) != "" {
		t.Error("no schedule, no next read")
	}
}

// folder stands in for files on disk: their change mark and the newest value in them.
type folder struct {
	mu   sync.Mutex
	mark string
	last float64
}

func (f *folder) set(mark string, last float64) {
	f.mu.Lock()
	f.mark, f.last = mark, last
	f.mu.Unlock()
}

// growingSource is a fake source over a folder that a loading job writes to.
type growingSource struct {
	*fakeSource
	f *folder
}

func (g growingSource) Mark(context.Context) (string, error) {
	g.f.mu.Lock()
	defer g.f.mu.Unlock()
	return g.f.mark, nil
}

func (g growingSource) Query(ctx context.Context, sql string) ([]adapter.Row, error) {
	rows, err := g.fakeSource.Query(ctx, sql)
	if strings.Contains(sql, "strftime") && len(rows) > 0 {
		g.f.mu.Lock()
		rows[len(rows)-1] = adapter.Row{"p": "2026-03", "c0": g.f.last, "c1": 920.0}
		g.f.mu.Unlock()
	}
	return rows, err
}

func watchedEnv(t *testing.T) (*env, *folder) {
	t.Helper()
	e := newEnv(t, true, nil)
	f := &folder{mark: "a", last: 12}
	fake := e.srv.BuildSource
	e.srv.BuildSource = func(d config.Data, secret func(string) string) (adapter.Adapter, error) {
		if d.Path == "wachsend" {
			return growingSource{&fakeSource{name: d.Path}, f}, nil
		}
		return fake(d, secret)
	}
	if code, out := e.do("PUT", "/api/settings", `{"data":{"path":"wachsend"}}`); code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	return e, f
}

func lastValue(t *testing.T, e *env) float64 {
	t.Helper()
	_, m := e.do("GET", "/api/metrics", "")
	s := m["kpis"].([]any)[0].(map[string]any)["series"].([]any)
	return s[len(s)-1].(float64)
}

// Files are watched every five minutes by default; a changed mark reads the
// Kosmos again, an unchanged one does not.
func TestWatchedFilesAreReadWhenTheyChange(t *testing.T) {
	e, f := watchedEnv(t)
	t0 := time.Date(2026, 11, 11, 5, 0, 0, 0, time.Local)
	_, s := e.do("GET", "/api/settings", "")
	if get(s, "refresh.watch").(float64) != 5 || get(s, "refresh.own") != false || get(s, "refresh.watchable") != true {
		t.Fatalf("usual schedule for files: %v", s["refresh"])
	}
	e.srv.tick(t0) // notes the mark
	e.srv.tick(t0.Add(5 * time.Minute))
	e.srv.bg.Wait()
	if st := e.srv.status(config.MainID); st.By != byHand {
		t.Fatalf("nothing changed, nothing read: %+v", st)
	}
	f.set("b", 15)
	e.srv.tick(t0.Add(7 * time.Minute)) // not its turn yet
	e.srv.bg.Wait()
	if lastValue(t, e) != 12 {
		t.Fatal("looked too early")
	}
	e.srv.tick(t0.Add(10 * time.Minute))
	e.srv.bg.Wait()
	if st := e.srv.status(config.MainID); st.By != byChange || lastValue(t, e) != 15 {
		t.Fatalf("a change should be read: %+v %v", st, lastValue(t, e))
	}
	// The read noted the new mark: the next look starts nothing.
	e.srv.tick(t0.Add(15 * time.Minute))
	e.srv.bg.Wait()
	if st := e.srv.status(config.MainID); st.By != byChange || st.Refreshing {
		t.Fatalf("%+v", st)
	}
}

func TestScheduleReadsAtItsTimes(t *testing.T) {
	e, _ := watchedEnv(t)
	if code, out := e.do("PUT", "/api/settings", `{"refresh":{"daily":["6:00"],"watch":0}}`); code != 200 {
		t.Fatalf("%d %v", code, out)
	}
	now := time.Date(2026, 11, 11, 5, 59, 40, 0, time.Local)
	e.srv.Now = func() time.Time { return now }
	_, s := e.do("GET", "/api/settings", "")
	daily := get(s, "refresh.daily").([]any)
	if len(daily) != 1 || daily[0] != "06:00" || get(s, "refresh.own") != true || get(s, "status.next") != time.Date(2026, 11, 11, 6, 0, 0, 0, time.Local).Format(time.RFC3339) {
		t.Fatalf("schedule: %v %v", s["refresh"], get(s, "status.next"))
	}
	e.srv.tick(now)
	now = now.Add(30 * time.Second)
	e.srv.tick(now)
	e.srv.bg.Wait()
	st := e.srv.status(config.MainID)
	if st.By != bySchedule || st.Next != time.Date(2026, 11, 12, 6, 0, 0, 0, time.Local).Format(time.RFC3339) {
		t.Fatalf("%+v", st)
	}
	// null goes back to the usual schedule of the source.
	if _, s := e.do("PUT", "/api/settings", `{"refresh":null}`); get(s, "refresh.own") != false || get(s, "refresh.watch").(float64) != 5 {
		t.Fatalf("reset: %v", s["refresh"])
	}
}

func TestScheduleOfAFurtherKosmos(t *testing.T) {
	e := newEnv(t, true, nil)
	if code, out := e.do("POST", "/api/kosmen", `{"data":{"type":"duckdb","name":"Zwei","path":"zwei"}}`); code != 201 {
		t.Fatalf("%d %v", code, out)
	}
	_, s := e.do("PUT", "/api/settings?k=zwei", `{"refresh":{"daily":["7:15","06:00","06:00"],"watch":0}}`)
	if d := get(s, "refresh.daily").([]any); len(d) != 2 || d[0] != "06:00" || d[1] != "07:15" {
		t.Fatalf("times: %v", s["refresh"])
	}
	if code, out := e.do("PUT", "/api/settings?k=zwei", `{"refresh":{"daily":["25:00"]}}`); code != 422 || !strings.Contains(out["error"].(string), "keine Uhrzeit") {
		t.Fatalf("%d %v", code, out)
	}
	cfg, _ := os.ReadFile(e.cfgPath)
	var c config.Config
	json.Unmarshal(cfg, &c)
	if c.Refresh != nil || c.Kosmen[0].Refresh == nil || len(c.Kosmen[0].Refresh.Daily) != 2 {
		t.Fatalf("the schedule belongs to its Kosmos: %s", cfg)
	}
}

func TestRefreshToken(t *testing.T) {
	e := newEnv(t, true, nil)
	if code, _ := e.do("POST", "/api/refresh", "", "Authorization", "Bearer lmt_irgendwas"); code != 401 {
		t.Fatalf("without a token set, nobody may ask: %d", code)
	}
	code, out := e.do("POST", "/api/refresh/token", "")
	tok, _ := out["token"].(string)
	if code != 201 || !strings.HasPrefix(tok, "lmt_") || len(tok) < 40 {
		t.Fatalf("%d %v", code, out)
	}
	_, s := e.do("GET", "/api/settings", "")
	if get(s, "refresh.token.set") != true || get(s, "refresh.token.hint") != tok[len(tok)-4:] || strings.Contains(mustJSON(s), tok) {
		t.Fatalf("token state: %v", s["refresh"])
	}
	if raw, _ := os.ReadFile(filepath.Join(e.dir, "data", "secrets.json")); strings.Contains(string(raw), tok) {
		t.Fatal("the secrets file must keep only a hash")
	}

	// A loading job gets an answer at once; the read runs behind it.
	code, out = e.do("POST", "/api/refresh", "", "Authorization", "Bearer "+tok)
	if code != 202 || out["kosmos"] != "main" {
		t.Fatalf("%d %v", code, out)
	}
	e.srv.bg.Wait()
	if st := e.srv.status(config.MainID); st.By != byTrigger || !st.OK {
		t.Fatalf("%+v", st)
	}
	// Webhook tools: the token as basic-auth password, a body of any kind.
	if code, out := e.do("POST", "/api/refresh", `{"run":"done"}`, "Authorization", "Basic "+basic("lumantic", tok), "Content-Type", "text/plain"); code != 202 {
		t.Fatalf("basic auth: %d %v", code, out)
	}
	e.srv.bg.Wait()
	if code, _ := e.do("POST", "/api/refresh", "", "Authorization", "Bearer "+tok+"x"); code != 401 {
		t.Fatalf("a wrong token: %d", code)
	}
	// The app's own page never needs one, even when a proxy adds credentials.
	if code, out := e.do("POST", "/api/refresh", "", "Authorization", "Basic eDp5", "Sec-Fetch-Site", "same-origin"); code != 200 || out["by"] != byHand {
		t.Fatalf("by hand: %d %v", code, out)
	}
	if code, _ := e.do("GET", "/api/refresh", ""); code != 200 {
		t.Fatalf("status for jobs: %d", code)
	}
	if code, _ := e.do("POST", "/api/refresh?k=gibtsnicht", "", "Authorization", "Bearer "+tok); code != 404 {
		t.Fatalf("unknown kosmos: %d", code)
	}
	if code, _ := e.do("DELETE", "/api/refresh/token", ""); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := e.do("POST", "/api/refresh", "", "Authorization", "Bearer "+tok); code != 401 {
		t.Fatalf("a removed token: %d", code)
	}
}

func TestRefreshTokenFromEnvironment(t *testing.T) {
	e := newEnv(t, true, map[string]string{"LUMANTIC_REFRESH_TOKEN": "lmt_aus-der-umgebung-1234"})
	if code, _ := e.do("POST", "/api/refresh", "", "Authorization", "Bearer lmt_aus-der-umgebung-1234"); code != 202 {
		t.Fatalf("env token: %d", code)
	}
	e.srv.bg.Wait()
	if code, _ := e.do("POST", "/api/refresh/token", ""); code != 409 {
		t.Fatalf("an env token cannot be replaced: %d", code)
	}
	if _, s := e.do("GET", "/api/settings", ""); get(s, "refresh.token.source") != "umgebung" {
		t.Fatalf("%v", s["refresh"])
	}
}

// Whoever asks during a read gets one more read after it, never a pile.
func TestReadsDoNotPileUp(t *testing.T) {
	e := newEnv(t, true, nil)
	l := e.srv.lockOf(config.MainID)
	l.Lock() // a read is under way
	if !e.srv.readSoon(config.MainID, byTrigger) {
		t.Fatal("the first ask waits for its turn")
	}
	if e.srv.readSoon(config.MainID, byTrigger) || e.srv.readSoon(config.MainID, bySchedule) {
		t.Fatal("further asks join the waiting read")
	}
	if !e.srv.status(config.MainID).Refreshing {
		t.Fatal("the status says a read is coming")
	}
	l.Unlock()
	e.srv.bg.Wait()
	if st := e.srv.status(config.MainID); st.Refreshing || st.By != byTrigger {
		t.Fatalf("%+v", st)
	}
}

// Open pages hear of every read over server-sent events.
func TestEventsReachOpenPages(t *testing.T) {
	e, f := watchedEnv(t)
	srv := httptest.NewServer(e.h)
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/events", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	lines := make(chan string, 32)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	next := func() event {
		t.Helper()
		for line := range lines {
			if data, ok := strings.CutPrefix(line, "data: "); ok {
				var ev event
				json.Unmarshal([]byte(data), &ev)
				return ev
			}
		}
		t.Fatal("the stream ended without an event")
		return event{}
	}
	for line := range lines { // subscribed once the stream has begun
		if strings.HasPrefix(line, "retry:") {
			break
		}
	}
	e.do("POST", "/api/refresh", "")
	if ev := next(); ev.Kosmos != config.MainID || !ev.OK || ev.Changed || ev.By != byHand {
		t.Fatalf("same figures: %+v", ev)
	}
	f.set("b", 15)
	e.do("POST", "/api/refresh", "")
	if ev := next(); !ev.Changed {
		t.Fatalf("new figures: %+v", ev)
	}
}

func basic(user, pw string) string {
	r := httptest.NewRequest("GET", "/", nil)
	r.SetBasicAuth(user, pw)
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Basic ")
}
