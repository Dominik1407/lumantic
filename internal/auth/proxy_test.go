package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/Dominik1407/lumantic/internal/config"
)

// clock is a clock the tests turn.
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func newClock() *clock { return &clock{t: time.Date(2026, 11, 11, 8, 0, 0, 0, time.UTC)} }

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *clock) Add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// events records what the login writes down.
type events struct {
	mu   sync.Mutex
	list []string
}

func (e *events) log(event string, u User) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.list = append(e.list, event+" "+u.ID)
}

func (e *events) all() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return slices.Clone(e.list)
}

func newTestProxy(t *testing.T, p config.AuthProxy) (Authenticator, *clock, *events) {
	t.Helper()
	cfg := config.Auth{Kind: "proxy", Proxy: p}
	config.NormalizeAuth(&cfg)
	clk, ev := newClock(), &events{}
	a, err := New(cfg, Options{Now: clk.Now, Log: ev.log})
	if err != nil {
		t.Fatal(err)
	}
	return a, clk, ev
}

func proxyRequest(remote string, headers map[string]string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remote
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	return r
}

var authentikHeaders = map[string]string{
	"X-authentik-username": "mmuster",
	"X-authentik-name":     "Max Muster",
	"X-authentik-email":    "max.muster@bank.ch",
	"X-authentik-groups":   "Finanz| Lumantic Admins ||  Risk ",
}

func TestProxyTrusted(t *testing.T) {
	a, _, _ := newTestProxy(t, config.AuthProxy{})
	if a.Kind() != "proxy" || a.LoginURL("/x") != "" || a.LogoutURL() != "/auth/logout" {
		t.Fatalf("kind %q, login %q, logout %q", a.Kind(), a.LoginURL("/x"), a.LogoutURL())
	}
	for _, remote := range []string{"127.0.0.1:51000", "[::1]:51000", "[::ffff:127.0.0.1]:51000", "127.0.0.1"} {
		u, ok := a.User(proxyRequest(remote, authentikHeaders))
		if !ok {
			t.Fatalf("%s: not signed in", remote)
		}
		want := User{ID: "mmuster", Name: "Max Muster", Email: "max.muster@bank.ch", Groups: []string{"Finanz", "Lumantic Admins", "Risk"}}
		if u.ID != want.ID || u.Name != want.Name || u.Email != want.Email || !slices.Equal(u.Groups, want.Groups) {
			t.Fatalf("%s: got %+v, want %+v", remote, u, want)
		}
	}
	tok, err := a.Token(context.Background(), proxyRequest("127.0.0.1:1", authentikHeaders))
	if tok != "" || err != nil {
		t.Fatalf("token %q, %v", tok, err)
	}
}

func TestProxyUntrusted(t *testing.T) {
	a, _, ev := newTestProxy(t, config.AuthProxy{})
	for _, remote := range []string{"10.1.2.3:51000", "[2001:db8::1]:443", "192.168.1.10:80", "", "garbage"} {
		if u, ok := a.User(proxyRequest(remote, authentikHeaders)); ok {
			t.Fatalf("%s: signed in as %+v from an untrusted address", remote, u)
		}
	}
	if len(ev.all()) != 0 {
		t.Fatalf("logged %v", ev.all())
	}
}

func TestProxyCIDR(t *testing.T) {
	a, _, _ := newTestProxy(t, config.AuthProxy{Trust: []string{"10.0.0.0/8", "192.168.5.7", "fd00::/8"}})
	for remote, want := range map[string]bool{
		"10.200.1.1:1":     true,
		"10.0.0.1:1":       true,
		"192.168.5.7:1":    true,
		"192.168.5.8:1":    false,
		"11.0.0.1:1":       false,
		"127.0.0.1:1":      false, // the defaults no longer apply
		"[fd12::1]:1":      true,
		"[fe80::1%eth0]:1": false,
	} {
		if _, ok := a.User(proxyRequest(remote, authentikHeaders)); ok != want {
			t.Errorf("%s: signed in %v, want %v", remote, ok, want)
		}
	}
}

func TestProxyHeaders(t *testing.T) {
	a, _, _ := newTestProxy(t, config.AuthProxy{User: "Remote-User", Name: "Remote-Name", Groups: "Remote-Groups", Sep: ","})
	u, ok := a.User(proxyRequest("127.0.0.1:1", map[string]string{"Remote-User": "anna", "Remote-Groups": "a, b,,c"}))
	if !ok || u.ID != "anna" || u.Name != "anna" || u.Email != "" || !slices.Equal(u.Groups, []string{"a", "b", "c"}) {
		t.Fatalf("got %+v, %v", u, ok)
	}
	u, ok = a.User(proxyRequest("127.0.0.1:1", map[string]string{"Remote-User": "anna"}))
	if !ok || u.Groups == nil || len(u.Groups) != 0 {
		t.Fatalf("without groups: %+v, %v", u, ok)
	}
	if _, ok := a.User(proxyRequest("127.0.0.1:1", map[string]string{"Remote-Name": "Anna", "Remote-User": "  "})); ok {
		t.Fatal("signed in without an account")
	}
}

func TestProxyBadTrust(t *testing.T) {
	for _, bad := range []string{"10.0.0.0/33", "proxy.bank.ch", "10.0.0.256"} {
		if _, err := newProxy(config.AuthProxy{Trust: []string{bad}}, Options{}); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestProxyLogout(t *testing.T) {
	a, _, ev := newTestProxy(t, config.AuthProxy{})
	mux := http.NewServeMux()
	a.Routes(mux)
	r := proxyRequest("127.0.0.1:1", authentikHeaders)
	r.URL.Path = "/auth/logout"
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, r)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/outpost.goauthentik.io/sign_out" {
		t.Fatalf("%d → %q", rec.Code, rec.Header().Get("Location"))
	}
	if got := ev.all(); !slices.Equal(got, []string{"abmeldung mmuster"}) {
		t.Fatalf("logged %v", got)
	}
}

func TestProxyLogsOncePerEightHours(t *testing.T) {
	a, clk, ev := newTestProxy(t, config.AuthProxy{})
	req := func() { a.User(proxyRequest("127.0.0.1:1", authentikHeaders)) }
	req()
	req()
	clk.Add(7 * time.Hour)
	req()
	a.User(proxyRequest("127.0.0.1:1", map[string]string{"X-authentik-username": "anna"}))
	if got := ev.all(); !slices.Equal(got, []string{"anmeldung mmuster", "anmeldung anna"}) {
		t.Fatalf("logged %v", got)
	}
	clk.Add(time.Hour + time.Second)
	req()
	if got := ev.all(); len(got) != 3 || got[2] != "anmeldung mmuster" {
		t.Fatalf("after 8 hours logged %v", got)
	}

	var wg sync.WaitGroup
	clk.Add(9 * time.Hour)
	for range 20 {
		wg.Go(req)
	}
	wg.Wait()
	if got := ev.all(); len(got) != 4 {
		t.Fatalf("concurrent requests logged %v", got)
	}
}
