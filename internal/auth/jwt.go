package auth

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// skew is how far the clocks of Lumantic and the provider may drift apart.
const skew = 2 * time.Minute

// jws is a signed token in compact form, split but not yet checked.
type jws struct {
	alg, kid string
	signed   []byte // header.payload, what the signature covers
	sig      []byte
	claims   map[string]any
}

func parseJWS(raw string) (*jws, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return nil, errors.New("Das ID-Token ist kein JWT.")
	}
	var h struct {
		Alg  string   `json:"alg"`
		Kid  string   `json:"kid"`
		Crit []string `json:"crit"`
	}
	t := &jws{signed: []byte(parts[0] + "." + parts[1])}
	b, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(b, &h) != nil {
		return nil, errors.New("Der Kopf des ID-Tokens ist unlesbar.")
	}
	if len(h.Crit) > 0 {
		return nil, fmt.Errorf("Das ID-Token verlangt unbekannte Erweiterungen (%s).", strings.Join(h.Crit, ", "))
	}
	t.alg, t.kid = h.Alg, h.Kid
	if b, err = base64.RawURLEncoding.DecodeString(parts[1]); err != nil || json.Unmarshal(b, &t.claims) != nil || t.claims == nil {
		return nil, errors.New("Der Inhalt des ID-Tokens ist unlesbar.")
	}
	if t.sig, err = base64.RawURLEncoding.DecodeString(parts[2]); err != nil {
		return nil, errors.New("Die Signatur des ID-Tokens ist unlesbar.")
	}
	return t, nil
}

// pubKey is one signing key of the provider.
type pubKey struct {
	kid string
	alg string // as the JWKS says; "" = not said
	key crypto.PublicKey
}

// fits says whether the key may check a token signed with alg and kid. Only
// RS256 and ES256 count: never "none", never HS* (that would be the client
// secret, or worse a public key used as one).
func (k pubKey) fits(alg, kid string) bool {
	if (kid != "" && k.kid != kid) || (k.alg != "" && k.alg != alg) {
		return false
	}
	switch alg {
	case "RS256":
		_, ok := k.key.(*rsa.PublicKey)
		return ok
	case "ES256":
		e, ok := k.key.(*ecdsa.PublicKey)
		return ok && e.Curve == elliptic.P256()
	}
	return false
}

// verify checks the signature with the key; fits must have said yes.
func (k pubKey) verify(t *jws) bool {
	h := sha256.Sum256(t.signed)
	switch key := k.key.(type) {
	case *rsa.PublicKey:
		return t.alg == "RS256" && rsa.VerifyPKCS1v15(key, crypto.SHA256, h[:], t.sig) == nil
	case *ecdsa.PublicKey:
		if t.alg != "ES256" || len(t.sig) != 64 {
			return false
		}
		der, err := asn1.Marshal(struct{ R, S *big.Int }{new(big.Int).SetBytes(t.sig[:32]), new(big.Int).SetBytes(t.sig[32:])})
		return err == nil && ecdsa.VerifyASN1(key, h[:], der)
	}
	return false
}

// parseJWKS reads the keys a provider publishes. Keys it cannot use (other
// types, other curves, encryption keys) are left out.
func parseJWKS(b []byte) ([]pubKey, error) {
	var set struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			Use string `json:"use"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
			Crv string `json:"crv"`
			X   string `json:"x"`
			Y   string `json:"y"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(b, &set); err != nil {
		return nil, errors.New("Die Schlüssel des Anbieters sind unlesbar.")
	}
	var keys []pubKey
	for _, k := range set.Keys {
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		var key crypto.PublicKey
		switch k.Kty {
		case "RSA":
			n, err1 := b64(k.N)
			e, err2 := b64(k.E)
			if err1 != nil || err2 != nil || len(n) == 0 || len(e) == 0 || len(e) > 4 {
				continue
			}
			exp := int(new(big.Int).SetBytes(e).Int64())
			if exp < 3 {
				continue
			}
			key = &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exp}
		case "EC":
			if k.Crv != "P-256" {
				continue
			}
			x, err1 := b64(k.X)
			y, err2 := b64(k.Y)
			if err1 != nil || err2 != nil || len(x) > 32 || len(y) > 32 {
				continue
			}
			pt := make([]byte, 65)
			pt[0] = 4
			copy(pt[33-len(x):33], x)
			copy(pt[65-len(y):], y)
			ec, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), pt)
			if err != nil {
				continue
			}
			key = ec
		default:
			continue
		}
		keys = append(keys, pubKey{kid: k.Kid, alg: k.Alg, key: key})
	}
	return keys, nil
}

// b64 decodes base64url, with or without padding.
func b64(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
}

// checkClaims checks who issued the token, for whom, until when and for which
// login (nonce).
func checkClaims(c map[string]any, issuer, clientID, nonce string, now time.Time) error {
	if iss, _ := c["iss"].(string); iss == "" || strings.TrimRight(iss, "/") != strings.TrimRight(issuer, "/") {
		return fmt.Errorf("Das ID-Token stammt von «%s», erwartet war «%s».", iss, issuer)
	}
	var aud []string
	switch a := c["aud"].(type) {
	case string:
		aud = []string{a}
	case []any:
		for _, x := range a {
			if s, ok := x.(string); ok {
				aud = append(aud, s)
			}
		}
	}
	found := false
	for _, a := range aud {
		found = found || a == clientID
	}
	if !found {
		return errors.New("Das ID-Token ist nicht für Lumantic ausgestellt.")
	}
	if azp, ok := c["azp"].(string); ok && azp != "" && azp != clientID {
		return errors.New("Das ID-Token ist für eine andere Anwendung ausgestellt.")
	}
	exp, ok := c["exp"].(float64)
	if !ok {
		return errors.New("Das ID-Token hat kein Ablaufdatum.")
	}
	if now.After(unix(exp).Add(skew)) {
		return errors.New("Das ID-Token ist abgelaufen.")
	}
	if nbf, ok := c["nbf"].(float64); ok && now.Add(skew).Before(unix(nbf)) {
		return errors.New("Das ID-Token gilt noch nicht.")
	}
	if n, _ := c["nonce"].(string); nonce == "" || n != nonce {
		return errors.New("Das ID-Token gehört nicht zu dieser Anmeldung.")
	}
	return nil
}

func unix(sec float64) time.Time {
	return time.Unix(int64(sec), 0)
}

// claimString reads a claim as text; "" when missing or not text.
func claimString(c map[string]any, name string) string {
	s, _ := c[name].(string)
	return strings.TrimSpace(s)
}

// claimList reads a claim as a list of texts; a single text counts as a list
// of one.
func claimList(c map[string]any, name string) []string {
	out := []string{}
	switch v := c[name].(type) {
	case string:
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
	}
	return out
}
