package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Dominik1407/lumantic/internal/config"
)

const (
	loginCookie   = "lumantic_login"
	sessionCookie = "lumantic_session"
	loginFor      = 10 * time.Minute // from /auth/login to /auth/callback
	sessionFor    = 8 * time.Hour
	maxLogins     = 10000 // logins under way; a flood of /auth/login cannot fill the memory
	// maxStates is how many logins one browser may have under way at once:
	// a restored browser with several Lumantic tabs starts them all together.
	maxStates = 5
)

const msgUnreachable = "Der Anbieter der Anmeldung ist nicht erreichbar. Bitte später nochmals versuchen."

// discovery is what the provider says about itself.
type discovery struct {
	Issuer      string   `json:"issuer"`
	Auth        string   `json:"authorization_endpoint"`
	Token       string   `json:"token_endpoint"`
	JWKS        string   `json:"jwks_uri"`
	EndSession  string   `json:"end_session_endpoint"`
	AuthMethods []string `json:"token_endpoint_auth_methods_supported"`
}

// pending is a login under way, kept by its state.
type pending struct {
	nonce, verifier, next, redirect string
}

// oidc signs people in with the authorization code flow and PKCE.
type oidc struct {
	cfg config.AuthOIDC
	opt Options

	discMu sync.Mutex
	disc   *discovery // nil until the first login reached the provider

	keysMu  sync.Mutex
	keys    []pubKey
	keysSet bool

	logins   *store[pending]
	sessions *store[*session]
}

func newOIDC(cfg config.AuthOIDC, opt Options) (Authenticator, error) {
	cfg.Issuer = strings.TrimSpace(cfg.Issuer)
	cfg.ClientID = strings.TrimSpace(cfg.ClientID)
	cfg.URL = strings.TrimRight(strings.TrimSpace(cfg.URL), "/")
	if cfg.Issuer == "" {
		return nil, errors.New("Für OpenID Connect braucht es die Adresse des Anbieters (issuer).")
	}
	if cfg.ClientID == "" {
		return nil, errors.New("Für OpenID Connect braucht es die Client-ID.")
	}
	if !slices.Contains(cfg.Scopes, "openid") {
		cfg.Scopes = append([]string{"openid"}, cfg.Scopes...)
	}
	return &oidc{
		cfg:      cfg,
		opt:      defaults(opt),
		logins:   newStore[pending](maxLogins),
		sessions: newStore[*session](0),
	}, nil
}

func (o *oidc) Kind() string { return "oidc" }

func (o *oidc) LoginURL(next string) string { return "/auth/login?next=" + url.QueryEscape(next) }

func (o *oidc) LogoutURL() string { return "/auth/logout" }

func (o *oidc) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/login", o.login)
	mux.HandleFunc("GET /auth/callback", o.callback)
	mux.HandleFunc("GET /auth/logout", o.logout)
}

func (o *oidc) User(r *http.Request) (User, bool) {
	s := o.session(r)
	if s == nil {
		return User{}, false
	}
	u := s.user
	u.Groups = slices.Clone(u.Groups)
	return u, true
}

// Token returns the session's access token, renewed with the refresh token
// when it runs out within a minute. Only one renewal per session runs at a
// time; who waits for it gets the renewed token.
func (o *oidc) Token(ctx context.Context, r *http.Request) (string, error) {
	s := o.session(r)
	if s == nil {
		return "", ErrExpired
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accessExp.IsZero() || o.opt.Now().Add(time.Minute).Before(s.accessExp) {
		return s.access, nil
	}
	if s.refresh == "" {
		return "", ErrExpired
	}
	d, err := o.discover(ctx)
	var tr *tokenResponse
	if err == nil {
		tr, err = o.tokenRequest(ctx, d, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {s.refresh}})
	}
	if err != nil || tr.AccessToken == "" {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", ErrExpired
	}
	s.access, s.accessExp = tr.AccessToken, tr.expiry(o.opt.Now())
	if tr.RefreshToken != "" {
		s.refresh = tr.RefreshToken
	}
	if tr.IDToken != "" {
		s.idToken = tr.IDToken // only kept as a hint for the logout
	}
	return s.access, nil
}

// session finds the request's session; nil when there is none.
func (o *oidc) session(r *http.Request) *session {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil
	}
	s, _ := o.sessions.get(c.Value, o.opt.Now())
	return s
}

// base is Lumantic's address as people reach it, without a trailing slash.
func (o *oidc) base(r *http.Request) string {
	if o.cfg.URL != "" {
		return o.cfg.URL
	}
	scheme := "http"
	if secure(r, "") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (o *oidc) login(w http.ResponseWriter, r *http.Request) {
	next := localPath(r.URL.Query().Get("next"))
	d, err := o.discover(r.Context())
	if err != nil {
		page(w, http.StatusBadGateway, msgUnreachable, err.Error(), o.LoginURL(next))
		return
	}
	auth, err := url.Parse(d.Auth)
	if err != nil {
		page(w, http.StatusBadGateway, msgUnreachable, err.Error(), o.LoginURL(next))
		return
	}
	state, nonce, verifier := random(32), random(32), random(32)
	redirect := o.base(r) + "/auth/callback"
	now := o.opt.Now()
	o.logins.put(state, pending{nonce: nonce, verifier: verifier, next: next, redirect: redirect}, now.Add(loginFor), now)
	states := append([]string{state}, loginStates(r)...)
	o.setLoginCookie(w, r, states[:min(len(states), maxStates)])

	challenge := sha256.Sum256([]byte(verifier))
	q := auth.Query()
	q.Set("response_type", "code")
	q.Set("client_id", o.cfg.ClientID)
	q.Set("redirect_uri", redirect)
	q.Set("scope", strings.Join(o.cfg.Scopes, " "))
	q.Set("state", state)
	q.Set("nonce", nonce)
	q.Set("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:]))
	q.Set("code_challenge_method", "S256")
	auth.RawQuery = q.Encode()
	noStore(w)
	http.Redirect(w, r, auth.String(), http.StatusFound)
}

func (o *oidc) callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	p, ok := o.takeLogin(w, r, q.Get("state"))
	again := "/auth/login"
	if ok {
		again = o.LoginURL(p.next)
	}
	if e := q.Get("error"); e != "" {
		detail := "" // the description is only shown for a login of this browser, not for any link
		if ok {
			if detail = q.Get("error_description"); detail == "" {
				detail = e
			}
		}
		page(w, http.StatusBadRequest, "Der Anbieter hat die Anmeldung abgelehnt.", detail, again)
		return
	}
	if !ok {
		if o.session(r) != nil { // back button after signing in: nothing to do
			noStore(w)
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		page(w, http.StatusBadRequest, ErrExpired.Error(), "", again)
		return
	}
	code := q.Get("code")
	if code == "" {
		page(w, http.StatusBadRequest, "Der Anbieter hat keinen Code geliefert.", "", again)
		return
	}
	ctx := r.Context()
	d, err := o.discover(ctx)
	if err != nil {
		page(w, http.StatusBadGateway, msgUnreachable, err.Error(), again)
		return
	}
	tr, err := o.tokenRequest(ctx, d, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {p.redirect},
		"code_verifier": {p.verifier},
	})
	if err != nil {
		page(w, http.StatusBadGateway, "Der Anbieter hat die Anmeldung nicht bestätigt.", err.Error(), again)
		return
	}
	if tr.IDToken == "" {
		page(w, http.StatusBadGateway, "Der Anbieter hat kein ID-Token geliefert.", "", again)
		return
	}
	claims, err := o.verifyIDToken(ctx, d, tr.IDToken, p.nonce)
	if err != nil {
		page(w, http.StatusBadRequest, "Die Anmeldung konnte nicht geprüft werden.", err.Error(), again)
		return
	}
	u, err := o.userFrom(claims)
	if err != nil {
		page(w, http.StatusBadRequest, "Die Anmeldung konnte nicht geprüft werden.", err.Error(), again)
		return
	}

	now := o.opt.Now()
	if c, err := r.Cookie(sessionCookie); err == nil {
		o.sessions.take(c.Value, now) // a new login replaces the old one
	}
	id := random(32)
	o.sessions.put(id, &session{
		user:      u,
		access:    tr.AccessToken,
		accessExp: tr.expiry(now),
		refresh:   tr.RefreshToken,
		idToken:   tr.IDToken,
	}, now.Add(sessionFor), now)
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: id, Path: "/", MaxAge: int(sessionFor / time.Second),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure(r, o.cfg.URL),
	})
	o.opt.Log("anmeldung", u)
	noStore(w)
	http.Redirect(w, r, p.next, http.StatusFound)
}

func (o *oidc) logout(w http.ResponseWriter, r *http.Request) {
	var hint string
	if c, err := r.Cookie(sessionCookie); err == nil {
		if s, ok := o.sessions.take(c.Value, o.opt.Now()); ok {
			s.mu.Lock()
			hint = s.idToken
			s.mu.Unlock()
			o.opt.Log("abmeldung", s.user)
		}
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Path: "/", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure(r, o.cfg.URL),
	})
	to := "/"
	if d := o.cached(); d != nil && d.EndSession != "" {
		if u, err := url.Parse(d.EndSession); err == nil {
			q := u.Query()
			if hint != "" {
				q.Set("id_token_hint", hint)
			} else {
				q.Set("client_id", o.cfg.ClientID) // Keycloak wants one of the two
			}
			q.Set("post_logout_redirect_uri", o.base(r)+"/")
			u.RawQuery = q.Encode()
			to = u.String()
		}
	}
	noStore(w)
	http.Redirect(w, r, to, http.StatusFound)
}

// loginStates reads the states of the logins this browser has under way.
func loginStates(r *http.Request) []string {
	c, err := r.Cookie(loginCookie)
	if err != nil {
		return nil
	}
	var out []string
	for _, s := range strings.Split(c.Value, ".") {
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// setLoginCookie binds the logins under way to this browser; none left
// clears the cookie.
func (o *oidc) setLoginCookie(w http.ResponseWriter, r *http.Request, states []string) {
	c := &http.Cookie{
		Name: loginCookie, Value: strings.Join(states, "."), Path: "/auth/", MaxAge: int(loginFor / time.Second),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: secure(r, o.cfg.URL),
	}
	if len(states) == 0 {
		c.MaxAge = -1
	}
	http.SetCookie(w, c)
}

// takeLogin returns the login of state when this browser started it and it
// is still fresh, and forgets it.
func (o *oidc) takeLogin(w http.ResponseWriter, r *http.Request, state string) (pending, bool) {
	states := loginStates(r)
	i := slices.Index(states, state)
	if state == "" || i < 0 {
		return pending{}, false
	}
	o.setLoginCookie(w, r, slices.Delete(states, i, i+1))
	return o.logins.take(state, o.opt.Now())
}

// discover asks the provider for its addresses once; a failure is not kept,
// so the next login asks again.
func (o *oidc) discover(ctx context.Context) (*discovery, error) {
	o.discMu.Lock()
	defer o.discMu.Unlock()
	if o.disc != nil {
		return o.disc, nil
	}
	var d discovery
	if err := o.getJSON(ctx, strings.TrimRight(o.cfg.Issuer, "/")+"/.well-known/openid-configuration", &d); err != nil {
		return nil, err
	}
	if strings.TrimRight(d.Issuer, "/") != strings.TrimRight(o.cfg.Issuer, "/") {
		return nil, fmt.Errorf("Der Anbieter nennt sich «%s», eingestellt ist «%s».", d.Issuer, o.cfg.Issuer)
	}
	if d.Auth == "" || d.Token == "" || d.JWKS == "" {
		return nil, errors.New("Der Anbieter nennt nicht alle Adressen, die es für die Anmeldung braucht.")
	}
	o.disc = &d
	return o.disc, nil
}

// cached is the discovery if a login already fetched it.
func (o *oidc) cached() *discovery {
	o.discMu.Lock()
	defer o.discMu.Unlock()
	return o.disc
}

// signingKeys returns the provider's keys, fetched once and again when fresh.
func (o *oidc) signingKeys(ctx context.Context, d *discovery, fresh bool) ([]pubKey, error) {
	o.keysMu.Lock()
	defer o.keysMu.Unlock()
	if o.keysSet && !fresh {
		return o.keys, nil
	}
	var raw json.RawMessage
	if err := o.getJSON(ctx, d.JWKS, &raw); err != nil {
		return nil, err
	}
	keys, err := parseJWKS(raw)
	if err != nil {
		return nil, err
	}
	o.keys, o.keysSet = keys, true
	return keys, nil
}

func (o *oidc) getJSON(ctx context.Context, u string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("«%s» ist keine Adresse.", u)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := o.opt.Client.Do(req)
	if err != nil {
		return fmt.Errorf("Keine Antwort von %s.", u)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s antwortet mit %s.", u, resp.Status)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(v); err != nil {
		return fmt.Errorf("Die Antwort von %s ist unlesbar.", u)
	}
	return nil
}

// verifyIDToken checks signature and claims of the ID token and returns its
// claims. An unknown key makes it fetch the keys once more: the provider may
// have rotated them.
func (o *oidc) verifyIDToken(ctx context.Context, d *discovery, raw, nonce string) (map[string]any, error) {
	t, err := parseJWS(raw)
	if err != nil {
		return nil, err
	}
	if t.alg != "RS256" && t.alg != "ES256" {
		return nil, fmt.Errorf("Das ID-Token ist mit «%s» signiert, Lumantic nimmt nur RS256 und ES256.", t.alg)
	}
	fitting := func(keys []pubKey) []pubKey {
		var out []pubKey
		for _, k := range keys {
			if k.fits(t.alg, t.kid) {
				out = append(out, k)
			}
		}
		return out
	}
	keys, err := o.signingKeys(ctx, d, false)
	if err != nil {
		return nil, err
	}
	cand := fitting(keys)
	if len(cand) == 0 {
		if keys, err = o.signingKeys(ctx, d, true); err != nil {
			return nil, err
		}
		cand = fitting(keys)
	}
	if len(cand) == 0 {
		return nil, fmt.Errorf("Der Schlüssel «%s» des ID-Tokens ist unbekannt.", t.kid)
	}
	if !slices.ContainsFunc(cand, func(k pubKey) bool { return k.verify(t) }) {
		return nil, errors.New("Die Signatur des ID-Tokens stimmt nicht.")
	}
	if err := checkClaims(t.claims, d.Issuer, o.cfg.ClientID, nonce, o.opt.Now()); err != nil {
		return nil, err
	}
	return t.claims, nil
}

// userFrom builds the person from the claims of the ID token.
func (o *oidc) userFrom(c map[string]any) (User, error) {
	u := User{ID: claimString(c, o.cfg.User), Groups: []string{}}
	if u.ID == "" {
		u.ID = claimString(c, "sub")
	}
	if u.ID == "" {
		return User{}, errors.New("Das ID-Token nennt kein Konto.")
	}
	if u.Name = claimString(c, "name"); u.Name == "" {
		u.Name = u.ID
	}
	u.Email = claimString(c, "email")
	if o.cfg.Groups != "" {
		u.Groups = claimList(c, o.cfg.Groups)
	}
	return u, nil
}

// tokenResponse is the answer of the token endpoint.
type tokenResponse struct {
	AccessToken  string  `json:"access_token"`
	ExpiresIn    seconds `json:"expires_in"`
	RefreshToken string  `json:"refresh_token"`
	IDToken      string  `json:"id_token"`
	Error        string  `json:"error"`
	Description  string  `json:"error_description"`
}

// expiry is when the access token runs out; zero when the provider did not say.
func (t *tokenResponse) expiry(now time.Time) time.Time {
	if t.ExpiresIn <= 0 {
		return time.Time{}
	}
	return now.Add(time.Duration(t.ExpiresIn) * time.Second)
}

// seconds reads a number of seconds that some providers send as text.
type seconds int64

func (s *seconds) UnmarshalJSON(b []byte) error {
	v := strings.Trim(string(b), `"`)
	if v == "" || v == "null" {
		*s = 0
		return nil
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return err
	}
	*s = seconds(f)
	return nil
}

// tokenRequest posts to the token endpoint. With a secret the client signs in
// with HTTP basic (or in the form when the provider only takes that); without
// one it is a public client and only names itself.
func (o *oidc) tokenRequest(ctx context.Context, d *discovery, form url.Values) (*tokenResponse, error) {
	secret := o.opt.Secret
	m := d.AuthMethods
	basic := secret != "" && (len(m) == 0 || slices.Contains(m, "client_secret_basic") || !slices.Contains(m, "client_secret_post"))
	if !basic {
		form.Set("client_id", o.cfg.ClientID)
		if secret != "" {
			form.Set("client_secret", secret)
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.Token, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("«%s» ist keine Adresse.", d.Token)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if basic {
		req.SetBasicAuth(url.QueryEscape(o.cfg.ClientID), url.QueryEscape(secret)) // RFC 6749, 2.3.1
	}
	resp, err := o.opt.Client.Do(req)
	if err != nil {
		return nil, errors.New("Keine Antwort vom Anbieter.")
	}
	defer resp.Body.Close()
	var tr tokenResponse
	err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&tr)
	if resp.StatusCode != http.StatusOK || tr.Error != "" {
		msg := tr.Description
		if msg == "" {
			msg = tr.Error
		}
		if msg == "" {
			msg = resp.Status
		}
		return nil, fmt.Errorf("Der Anbieter lehnt ab: %s", msg)
	}
	if err != nil {
		return nil, errors.New("Die Antwort des Anbieters ist unlesbar.")
	}
	return &tr, nil
}

func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

// page is the short page a failed login ends on, with a way to try again.
func page(w http.ResponseWriter, status int, msg, detail, again string) {
	noStore(w)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if detail != "" {
		detail = `<p style="opacity:.6;font-size:.875rem">` + html.EscapeString(detail) + `</p>`
	}
	fmt.Fprintf(w, `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Anmeldung – Lumantic</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5">
<p>%s</p>%s<p><a href="%s">Nochmals anmelden</a></p>
</body></html>
`, html.EscapeString(msg), detail, html.EscapeString(again))
}
