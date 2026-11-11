// Package auth signs people in: not at all (Lumantic on one machine), through a
// proxy in front that passes on who someone is (such as an Authentik outpost),
// or with OpenID Connect (Authentik, Entra ID, Keycloak, ADFS). Whatever the
// way, a request ends with a User: an account, a name and groups. Which groups
// may do what is decided elsewhere (the server); this package only says who.
package auth

import (
	"context"
	"net/http"
	"time"

	"github.com/Dominik1407/lumantic/internal/config"
)

// User is a signed-in person.
type User struct {
	ID     string   `json:"id"` // the account, e.g. mmuster
	Name   string   `json:"name"`
	Email  string   `json:"email,omitempty"`
	Groups []string `json:"groups"`
}

// Local is the person at the machine when nobody signs in.
var Local = User{ID: "lokal", Name: "Lokal", Groups: []string{}}

// Authenticator signs people in one way.
type Authenticator interface {
	// Kind is "none", "proxy" or "oidc".
	Kind() string
	// User says who sent the request; false when nobody is signed in.
	User(r *http.Request) (User, bool)
	// Token returns an access token of the person's login that stays valid for
	// at least a minute, renewed when needed, for asking a database in their
	// name. "" when the login gives none (none, proxy).
	Token(ctx context.Context, r *http.Request) (string, error)
	// Routes adds the login's own pages: /auth/login, /auth/callback, /auth/logout.
	Routes(mux *http.ServeMux)
	// LoginURL is where a page sends someone who is not signed in, coming back
	// to next afterwards. "" when Lumantic cannot sign people in itself (proxy).
	LoginURL(next string) string
	// LogoutURL is where «Abmelden» leads. "" when there is nothing to leave.
	LogoutURL() string
}

// Options are what New needs besides the settings.
type Options struct {
	Secret string                     // the OIDC client secret
	Client *http.Client               // nil = a client with a 20 s timeout
	Now    func() time.Time           // nil = time.Now; tests turn the clock
	Log    func(event string, u User) // "anmeldung" and "abmeldung"; nil = not written down
}

// New builds the login the settings describe. It does not reach out to the
// provider: an OpenID Connect provider is asked for its addresses when the
// first person signs in, so Lumantic starts even while the provider is down.
func New(cfg config.Auth, opt Options) (Authenticator, error) {
	switch cfg.Kind {
	case "proxy":
		return newProxy(cfg.Proxy, opt)
	case "oidc":
		return newOIDC(cfg.OIDC, opt)
	}
	return None{}, nil
}

// None is Lumantic on one machine: everyone is the local person.
type None struct{}

func (None) Kind() string                                         { return "none" }
func (None) User(*http.Request) (User, bool)                      { return Local, true }
func (None) Token(context.Context, *http.Request) (string, error) { return "", nil }
func (None) Routes(*http.ServeMux)                                {}
func (None) LoginURL(string) string                               { return "" }
func (None) LogoutURL() string                                    { return "" }
