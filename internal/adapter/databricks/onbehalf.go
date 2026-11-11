package databricks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Dominik1407/lumantic/internal/adapter"
)

var _ adapter.OnBehalf = (*Databricks)(nil)

// traded is a Databricks token got for one login token.
type traded struct {
	token   string
	expires time.Time
}

// As returns a Databricks that reads in a person's name (Weg 2). It trades the
// access token of their login for a Databricks token: OAuth token federation,
// where a federation policy in the Databricks account trusts the provider
// (Authentik, Entra ID). Unity Catalog then checks the person's own grants,
// row filters and column masks. The traded token is kept until it runs out.
func (d *Databricks) As(ctx context.Context, p adapter.Person) (adapter.Adapter, error) {
	if strings.TrimSpace(p.Token) == "" {
		return nil, errors.New("Für Databricks fehlt das Token deiner Anmeldung.")
	}
	tok, err := d.trade(ctx, p.Token)
	if err != nil {
		return nil, err
	}
	return &Databricks{Host: d.Host, Warehouse: d.Warehouse, Catalog: d.Catalog, Schema: d.Schema, Source: d.Source,
		Auth: "token", Token: tok, Client: d.Client}, nil
}

// trade swaps a login token for a Databricks token at /oidc/v1/token
// (RFC 8693 token exchange, as Databricks documents for token federation).
func (d *Databricks) trade(ctx context.Context, subject string) (string, error) {
	sum := sha256.Sum256([]byte(subject))
	key := hex.EncodeToString(sum[:])
	d.mu.Lock()
	if t, ok := d.traded[key]; ok && time.Now().Before(t.expires) {
		d.mu.Unlock()
		return t.token, nil
	}
	d.mu.Unlock()
	form := url.Values{
		"grant_type":         {"urn:ietf:params:oauth:grant-type:token-exchange"},
		"subject_token":      {subject},
		"subject_token_type": {"urn:ietf:params:oauth:token-type:jwt"},
		"scope":              {"all-apis"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.base()+"/oidc/v1/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := d.send(req, &tok); err != nil {
		return "", err
	}
	if tok.AccessToken == "" {
		return "", errors.New("databricks: Antwort ohne access_token")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.traded == nil {
		d.traded = map[string]traded{}
	}
	for k, t := range d.traded { // forget what ran out
		if time.Now().After(t.expires) {
			delete(d.traded, k)
		}
	}
	d.traded[key] = traded{token: tok.AccessToken, expires: time.Now().Add(time.Duration(tok.ExpiresIn)*time.Second - time.Minute)}
	return tok.AccessToken, nil
}
