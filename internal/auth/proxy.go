package auth

import (
	"context"
	"fmt"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"lumantic/internal/config"
)

// seenFor is how long a person who arrives through the proxy counts as signed
// in once: the proxy signs people in, Lumantic only sees them arrive, so it
// writes down an «anmeldung» at most once per account in this time.
const seenFor = 8 * time.Hour

// proxy trusts the headers of a proxy in front, but only on requests that come
// from one of its addresses.
type proxy struct {
	cfg   config.AuthProxy
	opt   Options
	trust []netip.Prefix
	seen  *store[struct{}]
}

func newProxy(cfg config.AuthProxy, opt Options) (Authenticator, error) {
	p := &proxy{cfg: cfg, opt: defaults(opt), seen: newStore[struct{}](0)}
	if p.cfg.Sep == "" {
		p.cfg.Sep = "|"
	}
	for _, t := range cfg.Trust {
		if t = strings.TrimSpace(t); t == "" {
			continue
		}
		pre, err := parseTrust(t)
		if err != nil {
			return nil, fmt.Errorf("«%s» ist keine Adresse. Für den Proxy gehen IP-Adressen oder Bereiche wie 10.0.0.0/8.", t)
		}
		p.trust = append(p.trust, pre)
	}
	return p, nil
}

// parseTrust reads an IP or a CIDR as a prefix; IPv4 inside IPv6 counts as IPv4.
func parseTrust(t string) (netip.Prefix, error) {
	if strings.Contains(t, "/") {
		pre, err := netip.ParsePrefix(t)
		if err != nil {
			return pre, err
		}
		if a := pre.Addr(); a.Is4In6() && pre.Bits() >= 96 {
			pre = netip.PrefixFrom(a.Unmap(), pre.Bits()-96)
		}
		return pre.Masked(), nil
	}
	a, err := netip.ParseAddr(t)
	if err != nil {
		return netip.Prefix{}, err
	}
	a = a.Unmap().WithZone("")
	return netip.PrefixFrom(a, a.BitLen()), nil
}

// trusted says whether the request comes straight from the proxy.
func (p *proxy) trusted(r *http.Request) bool {
	var a netip.Addr
	if ap, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
		a = ap.Addr()
	} else if a, err = netip.ParseAddr(r.RemoteAddr); err != nil {
		return false
	}
	a = a.Unmap().WithZone("")
	for _, pre := range p.trust {
		if pre.Contains(a) {
			return true
		}
	}
	return false
}

func (p *proxy) Kind() string { return "proxy" }

func (p *proxy) User(r *http.Request) (User, bool) {
	u, ok := p.user(r)
	if ok {
		now := p.opt.Now()
		if p.seen.add(u.ID, struct{}{}, now.Add(seenFor), now) {
			p.opt.Log("anmeldung", u)
		}
	}
	return u, ok
}

// user reads the person from the headers without writing anything down.
func (p *proxy) user(r *http.Request) (User, bool) {
	if !p.trusted(r) {
		return User{}, false
	}
	h := func(name string) string {
		if name == "" {
			return ""
		}
		return strings.TrimSpace(r.Header.Get(name))
	}
	u := User{ID: h(p.cfg.User), Name: h(p.cfg.Name), Email: h(p.cfg.Email), Groups: []string{}}
	if u.ID == "" {
		return User{}, false
	}
	if u.Name == "" {
		u.Name = u.ID
	}
	for _, g := range strings.Split(h(p.cfg.Groups), p.cfg.Sep) {
		if g = strings.TrimSpace(g); g != "" {
			u.Groups = append(u.Groups, g)
		}
	}
	return u, true
}

func (p *proxy) Token(context.Context, *http.Request) (string, error) { return "", nil }

// Routes adds /auth/logout, which leads to the proxy's own sign-out.
func (p *proxy) Routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/logout", func(w http.ResponseWriter, r *http.Request) {
		if u, ok := p.user(r); ok {
			p.seen.take(u.ID, p.opt.Now())
			p.opt.Log("abmeldung", u)
		}
		w.Header().Set("Cache-Control", "no-store")
		to := p.cfg.Logout
		if to == "" {
			to = "/"
		}
		http.Redirect(w, r, to, http.StatusFound)
	})
}

func (p *proxy) LoginURL(string) string { return "" }

func (p *proxy) LogoutURL() string { return "/auth/logout" }
