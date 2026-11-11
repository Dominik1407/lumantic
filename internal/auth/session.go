package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
)

// ErrExpired is what Token says when the login cannot give a valid token any
// more; the person has to sign in again.
var ErrExpired = errors.New("Die Anmeldung ist abgelaufen. Bitte nochmals anmelden.")

// defaults fills what the options leave open.
func defaults(opt Options) Options {
	if opt.Client == nil {
		opt.Client = &http.Client{Timeout: 20 * time.Second}
	}
	if opt.Now == nil {
		opt.Now = time.Now
	}
	if opt.Log == nil {
		opt.Log = func(string, User) {}
	}
	return opt
}

// random returns n random bytes, base64url without padding.
func random(n int) string {
	b := make([]byte, n)
	rand.Read(b) // never fails since Go 1.24
	return base64.RawURLEncoding.EncodeToString(b)
}

// store keeps values in memory until they expire. Expired entries are swept
// out at most once a minute when the store is touched; a full store makes room
// by dropping the entry that would expire first.
type store[V any] struct {
	mu    sync.Mutex
	m     map[string]entry[V]
	max   int // 0 = no limit
	swept time.Time
}

type entry[V any] struct {
	v   V
	exp time.Time
}

func newStore[V any](max int) *store[V] {
	return &store[V]{m: map[string]entry[V]{}, max: max}
}

// sweep drops expired entries; the caller holds mu.
func (s *store[V]) sweep(now time.Time) {
	if now.Sub(s.swept) < time.Minute {
		return
	}
	s.swept = now
	for k, e := range s.m {
		if !now.Before(e.exp) {
			delete(s.m, k)
		}
	}
}

func (s *store[V]) put(key string, v V, exp, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.set(key, v, exp, now)
}

// add puts the entry only when the key is missing or expired, and says so.
func (s *store[V]) add(key string, v V, exp, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.m[key]; ok && now.Before(e.exp) {
		return false
	}
	s.set(key, v, exp, now)
	return true
}

// set puts the entry; the caller holds mu.
func (s *store[V]) set(key string, v V, exp, now time.Time) {
	s.sweep(now)
	if _, ok := s.m[key]; !ok && s.max > 0 && len(s.m) >= s.max {
		var first string
		for k, e := range s.m {
			if first == "" || e.exp.Before(s.m[first].exp) {
				first = k
			}
		}
		delete(s.m, first)
	}
	s.m[key] = entry[V]{v, exp}
}

func (s *store[V]) get(key string, now time.Time) (V, bool) {
	return s.lookup(key, now, false)
}

// take returns the entry and removes it.
func (s *store[V]) take(key string, now time.Time) (V, bool) {
	return s.lookup(key, now, true)
}

func (s *store[V]) lookup(key string, now time.Time, remove bool) (V, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep(now)
	e, ok := s.m[key]
	if ok && (remove || !now.Before(e.exp)) {
		delete(s.m, key)
	}
	if !ok || !now.Before(e.exp) {
		var zero V
		return zero, false
	}
	return e.v, true
}

// session is one person signed in with OpenID Connect.
type session struct {
	user User

	mu        sync.Mutex // guards the tokens and lets only one refresh run
	access    string
	accessExp time.Time // zero = the provider did not say
	refresh   string
	idToken   string
}

// secure says whether cookies for this request get the Secure flag: the
// request came over TLS, through a proxy that says so, or Lumantic's own
// address is https.
func secure(r *http.Request, base string) bool {
	if r.TLS != nil || strings.HasPrefix(strings.ToLower(base), "https://") {
		return true
	}
	proto, _, _ := strings.Cut(r.Header.Get("X-Forwarded-Proto"), ",")
	return strings.EqualFold(strings.TrimSpace(proto), "https")
}

// localPath keeps next when it stays on Lumantic, else "/". Browsers read a
// backslash as a slash and drop tabs and line breaks, so "/\evil" and
// "/\t/evil" would lead elsewhere just like "//evil".
func localPath(next string) string {
	if !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.Contains(next, `\`) {
		return "/"
	}
	for _, c := range next {
		if c < 0x20 || c == 0x7f {
			return "/"
		}
	}
	return next
}
