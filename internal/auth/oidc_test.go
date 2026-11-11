package auth

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"lumantic/internal/config"
)

// ---- keys and signing ----

type keySet struct {
	rsa1, rsa2, rsaBad *rsa.PrivateKey
	ec1                *ecdsa.PrivateKey
}

var testKeys = sync.OnceValue(func() keySet {
	gen := func() *rsa.PrivateKey {
		k, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			panic(err)
		}
		return k
	}
	ec, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(err)
	}
	return keySet{rsa1: gen(), rsa2: gen(), rsaBad: gen(), ec1: ec}
})

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func rsaJWK(kid string, k *rsa.PublicKey) map[string]any {
	return map[string]any{"kty": "RSA", "kid": kid, "use": "sig", "alg": "RS256",
		"n": b64url(k.N.Bytes()), "e": b64url(big.NewInt(int64(k.E)).Bytes())}
}

func ecJWK(kid string, k *ecdsa.PublicKey) map[string]any {
	b, err := k.Bytes()
	if err != nil {
		panic(err)
	}
	return map[string]any{"kty": "EC", "kid": kid, "use": "sig", "alg": "ES256", "crv": "P-256",
		"x": b64url(b[1:33]), "y": b64url(b[33:])}
}

// noKey signs nothing: the token goes out with an empty signature.
type noKey struct{}

// sign makes a compact JWS; key is an *rsa.PrivateKey (RS256), an
// *ecdsa.PrivateKey (ES256), []byte (HS256) or noKey.
func sign(h, c map[string]any, key any) string {
	hb, _ := json.Marshal(h)
	cb, _ := json.Marshal(c)
	in := b64url(hb) + "." + b64url(cb)
	sum := sha256.Sum256([]byte(in))
	var sig []byte
	switch k := key.(type) {
	case *rsa.PrivateKey:
		sig, _ = rsa.SignPKCS1v15(rand.Reader, k, crypto.SHA256, sum[:])
	case *ecdsa.PrivateKey:
		der, err := ecdsa.SignASN1(rand.Reader, k, sum[:])
		if err != nil {
			panic(err)
		}
		var rs struct{ R, S *big.Int }
		if _, err := asn1.Unmarshal(der, &rs); err != nil {
			panic(err)
		}
		sig = make([]byte, 64)
		rs.R.FillBytes(sig[:32])
		rs.S.FillBytes(sig[32:])
	case []byte:
		m := hmac.New(sha256.New, k)
		m.Write([]byte(in))
		sig = m.Sum(nil)
	case noKey:
	}
	return in + "." + b64url(sig)
}

// ---- the fake provider ----

type grant struct{ challenge, redirect, idToken string }

type op struct {
	t        *testing.T
	srv      *httptest.Server
	issuer   string
	clientID string
	secret   string
	clk      *clock

	mu           sync.Mutex
	keys         []map[string]any
	jwksHits     int
	discoHits    int
	discoDown    bool
	noEndSession bool
	claimIssuer  string // the issuer discovery names; "" = the real one
	codes        map[string]grant
	n            int
	refreshes    map[string]bool
	refreshHits  int
	refreshFail  bool
	refreshWait  time.Duration
	expiresIn    int
	issued       int
}

func newOP(t *testing.T, secret string) *op {
	t.Helper()
	k := testKeys()
	p := &op{t: t, clientID: "lumantic", secret: secret, clk: newClock(),
		keys:      []map[string]any{rsaJWK("r1", &k.rsa1.PublicKey), ecJWK("e1", &k.ec1.PublicKey)},
		codes:     map[string]grant{},
		refreshes: map[string]bool{},
		expiresIn: 300,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /app/.well-known/openid-configuration", p.discovery)
	mux.HandleFunc("GET /jwks", p.jwks)
	mux.HandleFunc("POST /token", p.token)
	p.srv = httptest.NewServer(mux)
	t.Cleanup(p.srv.Close)
	p.issuer = p.srv.URL + "/app/" // like Authentik, with a trailing slash
	return p
}

func (p *op) discovery(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	p.discoHits++
	down, noEnd, iss := p.discoDown, p.noEndSession, p.claimIssuer
	p.mu.Unlock()
	if iss == "" {
		iss = p.issuer
	}
	if down {
		http.Error(w, "down", http.StatusServiceUnavailable)
		return
	}
	d := map[string]any{
		"issuer":                                iss,
		"authorization_endpoint":                p.srv.URL + "/authorize",
		"token_endpoint":                        p.srv.URL + "/token",
		"jwks_uri":                              p.srv.URL + "/jwks",
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post"},
	}
	if !noEnd {
		d["end_session_endpoint"] = p.srv.URL + "/logout"
	}
	json.NewEncoder(w).Encode(d)
}

func (p *op) jwks(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.jwksHits++
	json.NewEncoder(w).Encode(map[string]any{"keys": p.keys})
}

func (p *op) fail(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func (p *op) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		p.fail(w, 400, "invalid_request")
		return
	}
	f := r.PostForm
	id, sec, basic := r.BasicAuth()
	if p.secret != "" {
		if !basic || id != p.clientID || sec != p.secret || f.Has("client_secret") {
			p.t.Errorf("client auth: basic %v %q %q, form %v", basic, id, sec, f)
			p.fail(w, 401, "invalid_client")
			return
		}
	} else if basic || f.Get("client_id") != p.clientID {
		p.t.Errorf("public client: basic %v, form %v", basic, f)
		p.fail(w, 401, "invalid_client")
		return
	}
	switch f.Get("grant_type") {
	case "authorization_code":
		p.mu.Lock()
		g, ok := p.codes[f.Get("code")]
		delete(p.codes, f.Get("code"))
		p.mu.Unlock()
		sum := sha256.Sum256([]byte(f.Get("code_verifier")))
		switch {
		case !ok:
			p.fail(w, 400, "invalid_grant")
		case f.Get("redirect_uri") != g.redirect:
			p.t.Errorf("redirect_uri %q, want %q", f.Get("redirect_uri"), g.redirect)
			p.fail(w, 400, "invalid_grant")
		case b64url(sum[:]) != g.challenge:
			p.t.Errorf("code_verifier does not match the challenge")
			p.fail(w, 400, "invalid_grant")
		default:
			p.issue(w, g.idToken)
		}
	case "refresh_token":
		p.mu.Lock()
		wait := p.refreshWait
		p.mu.Unlock()
		time.Sleep(wait)
		p.mu.Lock()
		p.refreshHits++
		ok := p.refreshes[f.Get("refresh_token")] && !p.refreshFail
		delete(p.refreshes, f.Get("refresh_token")) // rotated
		p.mu.Unlock()
		if !ok {
			p.fail(w, 400, "invalid_grant")
			return
		}
		p.issue(w, "")
	default:
		p.fail(w, 400, "unsupported_grant_type")
	}
}

func (p *op) issue(w http.ResponseWriter, idToken string) {
	p.mu.Lock()
	p.issued++
	n := p.issued
	rt := fmt.Sprintf("refresh-%d", n)
	p.refreshes[rt] = true
	exp := p.expiresIn
	p.mu.Unlock()
	resp := map[string]any{"access_token": fmt.Sprintf("access-%d", n), "token_type": "Bearer", "expires_in": exp, "refresh_token": rt}
	if idToken != "" {
		resp["id_token"] = idToken
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (p *op) grant(st started, idToken string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.n++
	code := fmt.Sprintf("code-%d", p.n)
	p.codes[code] = grant{st.challenge, st.redirect, idToken}
	return code
}

func (p *op) claims(nonce string) map[string]any {
	now := p.clk.Now()
	return map[string]any{
		"iss": p.issuer, "aud": p.clientID, "sub": "u-4711",
		"preferred_username": "mmuster", "name": "Max Muster", "email": "max.muster@bank.ch",
		"groups": []string{"Lumantic Admins", "Finanz"},
		"nonce":  nonce, "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
	}
}

// idToken signs the usual claims with key (nil = the RSA key r1); edit may
// change header and claims first.
func (p *op) idToken(nonce string, key any, edit func(h, c map[string]any)) string {
	h := map[string]any{"alg": "RS256", "kid": "r1", "typ": "JWT"}
	c := p.claims(nonce)
	if edit != nil {
		edit(h, c)
	}
	if key == nil {
		key = testKeys().rsa1
	}
	return sign(h, c, key)
}

func (p *op) counts() (jwks, disco, refresh int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.jwksHits, p.discoHits, p.refreshHits
}

// ---- Lumantic under test ----

type app struct {
	op  *op
	a   Authenticator
	mux *http.ServeMux
	ev  *events
}

func newApp(t *testing.T, p *op, edit func(*config.AuthOIDC)) *app {
	t.Helper()
	cfg := config.Auth{Kind: "oidc", OIDC: config.AuthOIDC{Issuer: p.issuer, ClientID: p.clientID}}
	if edit != nil {
		edit(&cfg.OIDC)
	}
	config.NormalizeAuth(&cfg)
	ev := &events{}
	a, err := New(cfg, Options{Secret: p.secret, Client: p.srv.Client(), Now: p.clk.Now, Log: ev.log})
	if err != nil {
		t.Fatal(err)
	}
	x := &app{op: p, a: a, mux: http.NewServeMux(), ev: ev}
	a.Routes(x.mux)
	return x
}

func (x *app) request(target string, hdr http.Header, cookies ...*http.Cookie) *http.Request {
	r := httptest.NewRequest(http.MethodGet, target, nil)
	r.Host = "lumantic.test"
	for _, c := range cookies {
		if c != nil {
			r.AddCookie(c)
		}
	}
	for k, v := range hdr {
		r.Header[k] = v
	}
	return r
}

func (x *app) do(target string, hdr http.Header, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	x.mux.ServeHTTP(rec, x.request(target, hdr, cookies...))
	return rec
}

func cookieOf(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

// started is a login as the provider sees it arrive.
type started struct {
	loc                               *url.URL
	state, nonce, challenge, redirect string
	cookie                            *http.Cookie
}

func (x *app) begin(t *testing.T, next string, hdr http.Header, cookie *http.Cookie) started {
	t.Helper()
	rec := x.do("/auth/login?next="+url.QueryEscape(next), hdr, cookie)
	if rec.Code != http.StatusFound {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	q := loc.Query()
	st := started{loc: loc, state: q.Get("state"), nonce: q.Get("nonce"), challenge: q.Get("code_challenge"),
		redirect: q.Get("redirect_uri"), cookie: cookieOf(rec, loginCookie)}
	if st.state == "" || st.nonce == "" || st.challenge == "" || st.cookie == nil {
		t.Fatalf("login incomplete: %s, cookie %v", loc, st.cookie)
	}
	return st
}

// finish lets the provider hand out a code for idToken and calls the callback
// the way the browser would.
func (x *app) finish(st started, idToken string, hdr http.Header) *httptest.ResponseRecorder {
	code := x.op.grant(st, idToken)
	return x.do("/auth/callback?code="+code+"&state="+url.QueryEscape(st.state), hdr, st.cookie)
}

// signIn runs a whole login and returns the session cookie.
func (x *app) signIn(t *testing.T) *http.Cookie {
	t.Helper()
	st := x.begin(t, "/", nil, nil)
	rec := x.finish(st, x.op.idToken(st.nonce, nil, nil), nil)
	c := cookieOf(rec, sessionCookie)
	if rec.Code != http.StatusFound || c == nil {
		t.Fatalf("callback: %d %s", rec.Code, rec.Body)
	}
	return c
}

func refused(t *testing.T, rec *httptest.ResponseRecorder, status int, text string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status %d, want %d: %s", rec.Code, status, rec.Body)
	}
	if c := cookieOf(rec, sessionCookie); c != nil {
		t.Fatalf("session cookie set: %v", c)
	}
	if !strings.Contains(rec.Body.String(), text) {
		t.Fatalf("page lacks %q: %s", text, rec.Body)
	}
}

// ---- tests ----

func TestOIDCRoundTrip(t *testing.T) {
	p := newOP(t, "geheim-123")
	// configured without the trailing slash the provider's issuer has
	x := newApp(t, p, func(c *config.AuthOIDC) { c.Issuer = strings.TrimSuffix(p.issuer, "/") })
	if x.a.Kind() != "oidc" || x.a.LogoutURL() != "/auth/logout" {
		t.Fatalf("kind %q, logout %q", x.a.Kind(), x.a.LogoutURL())
	}
	if _, _, disco := p.counts(); disco != 0 {
		t.Fatal("New reached out to the provider")
	}

	st := x.begin(t, "/kosmos/finanz?tab=2", nil, nil)
	q := st.loc.Query()
	if got := st.loc.Scheme + "://" + st.loc.Host + st.loc.Path; got != p.srv.URL+"/authorize" {
		t.Fatalf("redirect to %s", got)
	}
	for k, want := range map[string]string{
		"response_type": "code", "client_id": "lumantic", "redirect_uri": "http://lumantic.test/auth/callback",
		"scope": "openid profile email offline_access", "code_challenge_method": "S256",
	} {
		if q.Get(k) != want {
			t.Errorf("%s = %q, want %q", k, q.Get(k), want)
		}
	}
	c := st.cookie
	if !c.HttpOnly || c.Secure || c.Path != "/auth/" || c.SameSite != http.SameSiteLaxMode || c.MaxAge <= 0 || c.MaxAge > 600 {
		t.Fatalf("login cookie %+v", c)
	}

	idt := p.idToken(st.nonce, nil, nil)
	rec := x.finish(st, idt, nil)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/kosmos/finanz?tab=2" {
		t.Fatalf("callback: %d → %q %s", rec.Code, rec.Header().Get("Location"), rec.Body)
	}
	sc := cookieOf(rec, sessionCookie)
	if sc == nil || !sc.HttpOnly || sc.Secure || sc.Path != "/" || sc.SameSite != http.SameSiteLaxMode || sc.MaxAge != 8*3600 {
		t.Fatalf("session cookie %+v", sc)
	}
	if raw, _ := base64.RawURLEncoding.DecodeString(sc.Value); len(raw) != 32 {
		t.Fatalf("session id %q is not 32 random bytes", sc.Value)
	}
	if lc := cookieOf(rec, loginCookie); lc == nil || lc.MaxAge >= 0 {
		t.Fatalf("login cookie not cleared: %+v", lc)
	}

	r := x.request("/kosmos/finanz", nil, sc)
	u, ok := x.a.User(r)
	if !ok || u.ID != "mmuster" || u.Name != "Max Muster" || u.Email != "max.muster@bank.ch" ||
		!slices.Equal(u.Groups, []string{"Lumantic Admins", "Finanz"}) {
		t.Fatalf("user %+v, %v", u, ok)
	}
	u.Groups[0] = "changed"
	if u2, _ := x.a.User(r); u2.Groups[0] != "Lumantic Admins" {
		t.Fatal("the caller can change the session's groups")
	}
	if tok, err := x.a.Token(context.Background(), r); tok != "access-1" || err != nil {
		t.Fatalf("token %q, %v", tok, err)
	}
	if got := x.ev.all(); !slices.Equal(got, []string{"anmeldung mmuster"}) {
		t.Fatalf("logged %v", got)
	}
	if _, ok := x.a.User(x.request("/", nil)); ok {
		t.Fatal("signed in without a cookie")
	}
	if _, ok := x.a.User(x.request("/", nil, &http.Cookie{Name: sessionCookie, Value: "made-up"})); ok {
		t.Fatal("signed in with a made-up session")
	}

	// the same callback again: the state is used up
	rec = x.do("/auth/callback?code=code-1&state="+url.QueryEscape(st.state), nil, st.cookie)
	refused(t, rec, http.StatusBadRequest, "abgelaufen")
	// ... unless it is the back button of someone signed in
	rec = x.do("/auth/callback?code=code-1&state="+url.QueryEscape(st.state), nil, st.cookie, sc)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" || cookieOf(rec, sessionCookie) != nil {
		t.Fatalf("back button: %d → %q", rec.Code, rec.Header().Get("Location"))
	}

	// a second login asks the provider for its addresses no more
	x.signIn(t)
	if jwks, disco, _ := p.counts(); disco != 1 || jwks != 1 {
		t.Fatalf("discovery fetched %d times, JWKS %d times", disco, jwks)
	}

	// after 8 hours the session is gone
	p.clk.Add(8*time.Hour + time.Second)
	if _, ok := x.a.User(r); ok {
		t.Fatal("session outlived 8 hours")
	}
}

func TestOIDCStateRefused(t *testing.T) {
	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)

	t.Run("no login cookie", func(t *testing.T) {
		st := x.begin(t, "/", nil, nil)
		code := p.grant(st, p.idToken(st.nonce, nil, nil))
		refused(t, x.do("/auth/callback?code="+code+"&state="+st.state, nil), http.StatusBadRequest, "abgelaufen")
	})
	t.Run("wrong state", func(t *testing.T) {
		st := x.begin(t, "/", nil, nil)
		code := p.grant(st, p.idToken(st.nonce, nil, nil))
		refused(t, x.do("/auth/callback?code="+code+"&state=forged", nil, st.cookie), http.StatusBadRequest, "abgelaufen")
		refused(t, x.do("/auth/callback?code="+code, nil, st.cookie), http.StatusBadRequest, "abgelaufen")
	})
	t.Run("cookie of another browser", func(t *testing.T) {
		mine := x.begin(t, "/", nil, nil)
		other := x.begin(t, "/", nil, nil)
		code := p.grant(mine, p.idToken(mine.nonce, nil, nil))
		refused(t, x.do("/auth/callback?code="+code+"&state="+mine.state, nil, other.cookie), http.StatusBadRequest, "abgelaufen")
	})
	t.Run("stale", func(t *testing.T) {
		st := x.begin(t, "/", nil, nil)
		p.clk.Add(11 * time.Minute)
		refused(t, x.finish(st, p.idToken(st.nonce, nil, nil), nil), http.StatusBadRequest, "abgelaufen")
	})
	t.Run("no code", func(t *testing.T) {
		st := x.begin(t, "/", nil, nil)
		refused(t, x.do("/auth/callback?state="+st.state, nil, st.cookie), http.StatusBadRequest, "keinen Code")
	})
}

func TestOIDCSeveralLoginsInOneBrowser(t *testing.T) {
	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)
	first := x.begin(t, "/a", nil, nil)
	second := x.begin(t, "/b", nil, first.cookie) // restored tabs log in together
	first.cookie = second.cookie
	rec := x.finish(first, p.idToken(first.nonce, nil, nil), nil)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/a" {
		t.Fatalf("first: %d %s", rec.Code, rec.Body)
	}
	second.cookie = cookieOf(rec, loginCookie)
	if second.cookie == nil || second.cookie.Value != second.state {
		t.Fatalf("login cookie after the first callback: %+v", second.cookie)
	}
	rec = x.finish(second, p.idToken(second.nonce, nil, nil), nil)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/b" {
		t.Fatalf("second: %d %s", rec.Code, rec.Body)
	}
}

func TestOIDCProviderError(t *testing.T) {
	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)
	st := x.begin(t, "/kosmos", nil, nil)
	rec := x.do("/auth/callback?error=access_denied&error_description="+url.QueryEscape("Kein Zugang <b>für</b> dich")+"&state="+st.state, nil, st.cookie)
	refused(t, rec, http.StatusBadRequest, "abgelehnt")
	body := rec.Body.String()
	if !strings.Contains(body, "Kein Zugang &lt;b&gt;für&lt;/b&gt; dich") || strings.Contains(body, "<b>") {
		t.Fatalf("description missing or not escaped: %s", body)
	}
	if !strings.Contains(body, `href="/auth/login?next=%2Fkosmos"`) {
		t.Fatalf("no way back to the login: %s", body)
	}
	// a link anyone could send does not get its text onto Lumantic's page
	rec = x.do("/auth/callback?error=access_denied&error_description=Ruf+0800+an", nil)
	refused(t, rec, http.StatusBadRequest, "abgelehnt")
	if strings.Contains(rec.Body.String(), "0800") || !strings.Contains(rec.Body.String(), `href="/auth/login"`) {
		t.Fatalf("page: %s", rec.Body)
	}
}

func TestOIDCIDTokenRefused(t *testing.T) {
	k := testKeys()
	for name, tc := range map[string]struct {
		key  any
		edit func(h, c map[string]any)
	}{
		"bad signature":   {k.rsaBad, nil},
		"wrong aud":       {nil, func(h, c map[string]any) { c["aud"] = "other-app" }},
		"aud list":        {nil, func(h, c map[string]any) { c["aud"] = []string{"a", "b"} }},
		"other azp":       {nil, func(h, c map[string]any) { c["aud"] = []string{"lumantic", "b"}; c["azp"] = "b" }},
		"wrong iss":       {nil, func(h, c map[string]any) { c["iss"] = "https://evil.example/app/" }},
		"expired":         {nil, func(h, c map[string]any) { c["exp"] = c["iat"].(int64) - 180 }},
		"no exp":          {nil, func(h, c map[string]any) { delete(c, "exp") }},
		"not yet":         {nil, func(h, c map[string]any) { c["nbf"] = c["iat"].(int64) + 600 }},
		"wrong nonce":     {nil, func(h, c map[string]any) { c["nonce"] = "other" }},
		"no nonce":        {nil, func(h, c map[string]any) { delete(c, "nonce") }},
		"alg none":        {noKey{}, func(h, c map[string]any) { h["alg"] = "none" }},
		"alg none no kid": {noKey{}, func(h, c map[string]any) { h["alg"] = "none"; delete(h, "kid") }},
		"HS256 secret":    {[]byte("geheim-123"), func(h, c map[string]any) { h["alg"] = "HS256" }},
		"HS256 no kid":    {[]byte("geheim-123"), func(h, c map[string]any) { h["alg"] = "HS256"; delete(h, "kid") }},
		"RS256 with EC":   {k.ec1, func(h, c map[string]any) { h["kid"] = "e1" }},
		"ES256 with RSA":  {nil, func(h, c map[string]any) { h["alg"] = "ES256" }},
		"crit":            {nil, func(h, c map[string]any) { h["crit"] = []string{"exp"} }},
		"no account":      {nil, func(h, c map[string]any) { delete(c, "sub"); delete(c, "preferred_username") }},
	} {
		t.Run(name, func(t *testing.T) {
			p := newOP(t, "geheim-123")
			x := newApp(t, p, nil)
			st := x.begin(t, "/", nil, nil)
			refused(t, x.finish(st, p.idToken(st.nonce, tc.key, tc.edit), nil), http.StatusBadRequest, "nicht geprüft")
			if len(x.ev.all()) != 0 {
				t.Fatalf("logged %v", x.ev.all())
			}
		})
	}
}

func TestOIDCIDTokenAccepted(t *testing.T) {
	k := testKeys()
	for name, tc := range map[string]struct {
		key  any
		edit func(h, c map[string]any)
		want User
	}{
		"ES256": {k.ec1, func(h, c map[string]any) {
			h["alg"], h["kid"] = "ES256", "e1"
			c["aud"], c["azp"] = []string{"other", "lumantic"}, "lumantic"
		}, User{ID: "mmuster", Name: "Max Muster", Email: "max.muster@bank.ch", Groups: []string{"Lumantic Admins", "Finanz"}}},
		"expired within the skew": {nil, func(h, c map[string]any) {
			c["exp"] = c["iat"].(int64) - 60
		}, User{ID: "mmuster", Name: "Max Muster", Email: "max.muster@bank.ch", Groups: []string{"Lumantic Admins", "Finanz"}}},
		"sub, one group, no name": {nil, func(h, c map[string]any) {
			delete(c, "preferred_username")
			delete(c, "name")
			delete(c, "email")
			c["groups"] = "Finanz"
		}, User{ID: "u-4711", Name: "u-4711", Groups: []string{"Finanz"}}},
		"no kid in the token": {nil, func(h, c map[string]any) {
			delete(h, "kid")
			delete(c, "groups")
		}, User{ID: "mmuster", Name: "Max Muster", Email: "max.muster@bank.ch", Groups: []string{}}},
	} {
		t.Run(name, func(t *testing.T) {
			p := newOP(t, "geheim-123")
			x := newApp(t, p, nil)
			st := x.begin(t, "/", nil, nil)
			rec := x.finish(st, p.idToken(st.nonce, tc.key, tc.edit), nil)
			c := cookieOf(rec, sessionCookie)
			if rec.Code != http.StatusFound || c == nil {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			u, ok := x.a.User(x.request("/", nil, c))
			if !ok || u.ID != tc.want.ID || u.Name != tc.want.Name || u.Email != tc.want.Email ||
				u.Groups == nil || !slices.Equal(u.Groups, tc.want.Groups) {
				t.Fatalf("user %+v, want %+v", u, tc.want)
			}
		})
	}
}

func TestOIDCClaimNames(t *testing.T) {
	p := newOP(t, "geheim-123")
	x := newApp(t, p, func(c *config.AuthOIDC) { c.User, c.Groups = "upn", "roles" })
	st := x.begin(t, "/", nil, nil)
	rec := x.finish(st, p.idToken(st.nonce, nil, func(h, c map[string]any) {
		c["upn"] = "max.muster@bank.ch"
		c["roles"] = []any{"Reporting.Read", 7, ""}
	}), nil)
	u, ok := x.a.User(x.request("/", nil, cookieOf(rec, sessionCookie)))
	if !ok || u.ID != "max.muster@bank.ch" || !slices.Equal(u.Groups, []string{"Reporting.Read"}) {
		t.Fatalf("user %+v, %v", u, ok)
	}
}

func TestOIDCKeyRotation(t *testing.T) {
	k := testKeys()
	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)
	x.signIn(t)
	if jwks, _, _ := p.counts(); jwks != 1 {
		t.Fatalf("JWKS fetched %d times", jwks)
	}

	p.mu.Lock()
	p.keys = []map[string]any{rsaJWK("r2", &k.rsa2.PublicKey)}
	p.mu.Unlock()
	rotated := func(h, c map[string]any) { h["kid"] = "r2" }
	st := x.begin(t, "/", nil, nil)
	if rec := x.finish(st, p.idToken(st.nonce, k.rsa2, rotated), nil); rec.Code != http.StatusFound {
		t.Fatalf("after rotation: %d %s", rec.Code, rec.Body)
	}
	if jwks, _, _ := p.counts(); jwks != 2 {
		t.Fatalf("JWKS fetched %d times, want 2", jwks)
	}
	st = x.begin(t, "/", nil, nil)
	if rec := x.finish(st, p.idToken(st.nonce, k.rsa2, rotated), nil); rec.Code != http.StatusFound {
		t.Fatalf("second login after rotation: %d %s", rec.Code, rec.Body)
	}
	if jwks, _, _ := p.counts(); jwks != 2 {
		t.Fatalf("JWKS fetched %d times for a known key", jwks)
	}

	st = x.begin(t, "/", nil, nil)
	rec := x.finish(st, p.idToken(st.nonce, k.rsa2, func(h, c map[string]any) { h["kid"] = "r9" }), nil)
	refused(t, rec, http.StatusBadRequest, "r9")
	if jwks, _, _ := p.counts(); jwks != 3 {
		t.Fatalf("JWKS fetched %d times, want exactly one more for an unknown key", jwks)
	}
}

func TestOIDCRefresh(t *testing.T) {
	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)
	sc := x.signIn(t)
	ctx := context.Background()
	token := func() (string, error) { return x.a.Token(ctx, x.request("/", nil, sc)) }

	p.clk.Add(3 * time.Minute) // 2 minutes left: no refresh yet
	if tok, err := token(); tok != "access-1" || err != nil {
		t.Fatalf("token %q, %v", tok, err)
	}
	if _, _, n := p.counts(); n != 0 {
		t.Fatalf("refreshed %d times too early", n)
	}

	p.clk.Add(90 * time.Second) // 30 seconds left
	p.mu.Lock()
	p.refreshWait = 50 * time.Millisecond
	p.mu.Unlock()
	got := make([]string, 10)
	errs := make([]error, 10)
	var wg sync.WaitGroup
	for i := range got {
		wg.Go(func() { got[i], errs[i] = token() })
	}
	wg.Wait()
	for i := range got {
		if got[i] != "access-2" || errs[i] != nil {
			t.Fatalf("caller %d: %q, %v", i, got[i], errs[i])
		}
	}
	if _, _, n := p.counts(); n != 1 {
		t.Fatalf("refreshed %d times, want once", n)
	}

	// the provider rotated the refresh token: the next refresh uses the new one
	p.clk.Add(5 * time.Minute)
	if tok, err := token(); tok != "access-3" || err != nil {
		t.Fatalf("second refresh: %q, %v", tok, err)
	}
	if _, _, n := p.counts(); n != 2 {
		t.Fatalf("refreshed %d times, want twice", n)
	}
}

func TestOIDCRefreshFails(t *testing.T) {
	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)
	sc := x.signIn(t)
	p.mu.Lock()
	p.refreshFail = true
	p.mu.Unlock()
	p.clk.Add(10 * time.Minute)
	tok, err := x.a.Token(context.Background(), x.request("/", nil, sc))
	if tok != "" || !errors.Is(err, ErrExpired) || err.Error() != "Die Anmeldung ist abgelaufen. Bitte nochmals anmelden." {
		t.Fatalf("token %q, %v", tok, err)
	}
	if _, ok := x.a.User(x.request("/", nil, sc)); !ok {
		t.Fatal("a failed refresh ended the session")
	}
	if _, err := x.a.Token(context.Background(), x.request("/", nil)); !errors.Is(err, ErrExpired) {
		t.Fatalf("token without a session: %v", err)
	}
}

func TestOIDCPublicClient(t *testing.T) {
	p := newOP(t, "") // the fake provider checks: client_id in the form, no basic auth
	x := newApp(t, p, nil)
	sc := x.signIn(t)
	p.clk.Add(10 * time.Minute)
	if tok, err := x.a.Token(context.Background(), x.request("/", nil, sc)); tok != "access-2" || err != nil {
		t.Fatalf("refresh as a public client: %q, %v", tok, err)
	}
}

func TestOIDCLogout(t *testing.T) {
	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)

	// before anyone signed in, Lumantic knows no provider address
	if rec := x.do("/auth/logout", nil); rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" {
		t.Fatalf("logout without login: %d → %q", rec.Code, rec.Header().Get("Location"))
	}

	st := x.begin(t, "/", nil, nil)
	idt := p.idToken(st.nonce, nil, nil)
	sc := cookieOf(x.finish(st, idt, nil), sessionCookie)
	rec := x.do("/auth/logout", nil, sc)
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if rec.Code != http.StatusFound || loc.Scheme+"://"+loc.Host+loc.Path != p.srv.URL+"/logout" {
		t.Fatalf("logout: %d → %s", rec.Code, loc)
	}
	if q := loc.Query(); q.Get("id_token_hint") != idt || q.Get("post_logout_redirect_uri") != "http://lumantic.test/" {
		t.Fatalf("logout query %v", q)
	}
	if c := cookieOf(rec, sessionCookie); c == nil || c.MaxAge >= 0 || c.Value != "" {
		t.Fatalf("session cookie not cleared: %+v", c)
	}
	if _, ok := x.a.User(x.request("/", nil, sc)); ok {
		t.Fatal("still signed in after logout")
	}
	if got := x.ev.all(); !slices.Equal(got, []string{"anmeldung mmuster", "abmeldung mmuster"}) {
		t.Fatalf("logged %v", got)
	}

	// a provider without end_session_endpoint: back to Lumantic
	p2 := newOP(t, "geheim-123")
	p2.noEndSession = true
	x2 := newApp(t, p2, func(c *config.AuthOIDC) { c.URL = "https://reports.bank.ch/" })
	sc = x2.signIn(t)
	if rec := x2.do("/auth/logout", nil, sc); rec.Header().Get("Location") != "/" {
		t.Fatalf("logout → %q", rec.Header().Get("Location"))
	}
}

func TestOIDCNextMustBeLocal(t *testing.T) {
	for next, want := range map[string]string{
		"/kosmos/finanz?tab=2": "/kosmos/finanz?tab=2",
		"/":                    "/",
		"":                     "/",
		"kosmos":               "/",
		"//evil.example/x":     "/",
		"https://evil.example": "/",
		`/\evil.example`:       "/",
		"/\t/evil.example":     "/",
		"/%0a/x":               "/%0a/x", // still encoded: stays on Lumantic
	} {
		if got := localPath(next); got != want {
			t.Errorf("localPath(%q) = %q, want %q", next, got, want)
		}
	}

	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)
	if got := x.a.LoginURL("/kosmos/a b?x=1&y=2"); got != "/auth/login?next=%2Fkosmos%2Fa+b%3Fx%3D1%26y%3D2" {
		t.Fatalf("LoginURL = %q", got)
	}
	st := x.begin(t, "//evil.example/steal", nil, nil)
	rec := x.finish(st, p.idToken(st.nonce, nil, nil), nil)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/" {
		t.Fatalf("callback → %q", rec.Header().Get("Location"))
	}
}

func TestOIDCSecureBehindProxy(t *testing.T) {
	p := newOP(t, "geheim-123")
	x := newApp(t, p, nil)
	https := http.Header{"X-Forwarded-Proto": {"https"}}
	st := x.begin(t, "/", https, nil)
	if st.redirect != "https://lumantic.test/auth/callback" || !st.cookie.Secure {
		t.Fatalf("redirect_uri %q, login cookie %+v", st.redirect, st.cookie)
	}
	rec := x.finish(st, p.idToken(st.nonce, nil, nil), https)
	if c := cookieOf(rec, sessionCookie); c == nil || !c.Secure {
		t.Fatalf("session cookie %+v", c)
	}

	// Lumantic's own address, when set, wins over the request
	x2 := newApp(t, p, func(c *config.AuthOIDC) { c.URL = "https://reports.bank.ch/" })
	st = x2.begin(t, "/", nil, nil)
	if st.redirect != "https://reports.bank.ch/auth/callback" || !st.cookie.Secure {
		t.Fatalf("redirect_uri %q, login cookie %+v", st.redirect, st.cookie)
	}
}

func TestOIDCDiscovery(t *testing.T) {
	p := newOP(t, "geheim-123")
	p.discoDown = true
	x := newApp(t, p, nil)
	rec := x.do("/auth/login?next=/k", nil)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "nicht erreichbar") {
		t.Fatalf("provider down: %d %s", rec.Code, rec.Body)
	}
	p.mu.Lock()
	p.discoDown = false
	p.mu.Unlock()
	x.signIn(t) // tries again
	if _, disco, _ := p.counts(); disco != 2 {
		t.Fatalf("discovery fetched %d times", disco)
	}

	// a provider that names itself differently is not trusted
	p.mu.Lock()
	p.claimIssuer = "https://evil.example/app/"
	p.mu.Unlock()
	rec = newApp(t, p, nil).do("/auth/login", nil)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "nennt sich") {
		t.Fatalf("issuer mismatch: %d %s", rec.Code, rec.Body)
	}
}

func TestNew(t *testing.T) {
	a, err := New(config.Auth{Kind: "none"}, Options{})
	if err != nil || a.Kind() != "none" {
		t.Fatalf("none: %v, %v", a, err)
	}
	if _, err := New(config.Auth{Kind: "oidc", OIDC: config.AuthOIDC{ClientID: "x"}}, Options{}); err == nil {
		t.Fatal("oidc without issuer accepted")
	}
	if _, err := New(config.Auth{Kind: "oidc", OIDC: config.AuthOIDC{Issuer: "https://idp.example"}}, Options{}); err == nil {
		t.Fatal("oidc without client id accepted")
	}
}
