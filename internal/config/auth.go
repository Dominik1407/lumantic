package config

import (
	"errors"
	"fmt"
	"net"
	"strings"
)

// Auth says how people sign in and who may change what. Without a login
// nobody signs in, and Lumantic only serves its own machine (127.0.0.1).
type Auth struct {
	Kind   string    `json:"kind"`   // "none", "proxy" or "oidc"
	Admins []string  `json:"admins"` // groups that may change data sources, Lumina and Kosmen; empty = everyone signed in
	Proxy  AuthProxy `json:"proxy,omitzero"`
	OIDC   AuthOIDC  `json:"oidc,omitzero"`
}

// AuthProxy trusts a proxy in front, such as an Authentik outpost, that signs
// people in and passes on who they are in headers. Headers count only when the
// request comes from one of the trusted addresses.
type AuthProxy struct {
	User   string   `json:"user"`   // header with the account; default X-authentik-username
	Name   string   `json:"name"`   // header with the display name; default X-authentik-name
	Email  string   `json:"email"`  // header with the e-mail; default X-authentik-email
	Groups string   `json:"groups"` // header with the groups; default X-authentik-groups
	Sep    string   `json:"sep"`    // separator between groups; default "|"
	Trust  []string `json:"trust"`  // addresses of the proxy, IPs or CIDRs; default 127.0.0.1 and ::1
	Logout string   `json:"logout"` // where «Abmelden» leads; default /outpost.goauthentik.io/sign_out
}

// AuthOIDC signs people in with OpenID Connect: Authentik, Entra ID, Keycloak
// or ADFS. The client secret lives with the secrets (OIDCSecret).
type AuthOIDC struct {
	Issuer   string   `json:"issuer"` // e.g. https://authentik.bank.ch/application/o/lumantic/
	ClientID string   `json:"clientId"`
	Scopes   []string `json:"scopes"` // default openid, profile, email, offline_access
	User     string   `json:"user"`   // claim with the account; default preferred_username
	Groups   string   `json:"groups"` // claim with the groups; default groups
	URL      string   `json:"url"`    // Lumantic's address as people reach it, for the way back; empty = from the request
}

// Rights of a Kosmos: who sees it, who looks after its key figures, and who
// decides what the numbers show. Empty lists mean everyone signed in.
const (
	RightsLumantic = "lumantic" // Weg 1: Lumantic reads with its own account and checks the groups
	RightsSource   = "source"   // Weg 2: Lumantic asks the database in the person's name
)

// NormalizeAuth fills the defaults of the kind in use and drops the others.
func NormalizeAuth(a *Auth) {
	a.Kind = strings.ToLower(strings.TrimSpace(a.Kind))
	if a.Kind == "" {
		a.Kind = "none"
	}
	a.Admins = cleanList(a.Admins)
	if a.Kind != "proxy" {
		a.Proxy = AuthProxy{}
	} else {
		p := &a.Proxy
		for _, f := range []struct {
			v   *string
			def string
		}{{&p.User, "X-authentik-username"}, {&p.Name, "X-authentik-name"}, {&p.Email, "X-authentik-email"},
			{&p.Groups, "X-authentik-groups"}, {&p.Logout, "/outpost.goauthentik.io/sign_out"}} {
			if *f.v = strings.TrimSpace(*f.v); *f.v == "" {
				*f.v = f.def
			}
		}
		if p.Sep == "" {
			p.Sep = "|"
		}
		if p.Trust = cleanList(p.Trust); len(p.Trust) == 0 {
			p.Trust = []string{"127.0.0.1", "::1"}
		}
	}
	if a.Kind != "oidc" {
		a.OIDC = AuthOIDC{}
	} else {
		o := &a.OIDC
		o.Issuer, o.ClientID, o.URL = strings.TrimSpace(o.Issuer), strings.TrimSpace(o.ClientID), strings.TrimRight(strings.TrimSpace(o.URL), "/")
		if o.Scopes = cleanList(o.Scopes); len(o.Scopes) == 0 {
			o.Scopes = []string{"openid", "profile", "email", "offline_access"}
		}
		if o.User = strings.TrimSpace(o.User); o.User == "" {
			o.User = "preferred_username"
		}
		if o.Groups = strings.TrimSpace(o.Groups); o.Groups == "" {
			o.Groups = "groups"
		}
	}
}

// ValidateAuth checks the login. Messages are for people.
func ValidateAuth(a Auth) error {
	switch a.Kind {
	case "none":
	case "proxy":
		for _, t := range a.Proxy.Trust {
			if _, _, err := net.ParseCIDR(t); err != nil && net.ParseIP(t) == nil {
				return fmt.Errorf("«%s» ist keine Adresse. Für den Proxy gehen IP-Adressen oder Bereiche wie 10.0.0.0/8.", t)
			}
		}
	case "oidc":
		o := a.OIDC
		if !httpURL(o.Issuer) {
			return errors.New("Für OpenID Connect braucht es die Adresse des Anbieters (issuer), z. B. https://authentik.bank.ch/application/o/lumantic/.")
		}
		if o.ClientID == "" {
			return errors.New("Für OpenID Connect braucht es die Client-ID.")
		}
		if o.URL != "" && !httpURL(o.URL) {
			return errors.New("Die eigene Adresse von Lumantic muss mit http:// oder https:// beginnen.")
		}
	default:
		return fmt.Errorf("Unbekannte Anmeldung %q. Möglich sind none, proxy und oidc.", a.Kind)
	}
	return nil
}

// validateRights checks the rights of one Kosmos against its source and the login.
func validateRights(rights string, d Data, a Auth) error {
	switch rights {
	case "", RightsLumantic:
		return nil
	case RightsSource:
		if d.Type != "snowflake" && d.Type != "databricks" {
			return errors.New("In deinem Namen fragen kann Lumantic nur Snowflake und Databricks. Für andere Quellen prüft Lumantic die Gruppen selbst.")
		}
		if a.Kind != "oidc" {
			return errors.New("In deinem Namen fragen geht nur mit der Anmeldung über OpenID Connect, denn nur dabei entsteht ein Token in deinem Namen.")
		}
		return nil
	}
	return fmt.Errorf("Unbekannte Rechte %q. Möglich sind lumantic und source.", rights)
}

func cleanList(xs []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, x := range xs {
		if x = strings.TrimSpace(x); x != "" && !seen[strings.ToLower(x)] {
			seen[strings.ToLower(x)] = true
			out = append(out, x)
		}
	}
	return out
}

// InGroups says whether a person with groups belongs to one of want. An empty
// want means everyone. Names compare without regard to case.
func InGroups(groups, want []string) bool {
	if len(want) == 0 {
		return true
	}
	for _, g := range groups {
		for _, w := range want {
			if strings.EqualFold(g, w) {
				return true
			}
		}
	}
	return false
}
