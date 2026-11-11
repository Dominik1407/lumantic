package snowflake

import (
	"context"
	"errors"
	"strings"

	"lumantic/internal/adapter"
)

var _ adapter.OnBehalf = (*Snowflake)(nil)

// As returns a Snowflake that reads in a person's name (Weg 2). It sends the
// access token of their login as an OAuth token; Snowflake checks it with an
// External OAuth integration that trusts the same provider (Authentik, Entra
// ID). No role is sent, so the person's own role and its row access policies
// apply, as the token's scope allows.
func (s *Snowflake) As(_ context.Context, p adapter.Person) (adapter.Adapter, error) {
	if strings.TrimSpace(p.Token) == "" {
		return nil, errors.New("Für Snowflake fehlt das Token deiner Anmeldung.")
	}
	return &Snowflake{Account: s.Account, User: p.ID, Warehouse: s.Warehouse, Database: s.Database, Schema: s.Schema,
		Source: s.Source, Auth: "token", Token: p.Token, TokenType: "OAUTH", BaseURL: s.BaseURL, Client: s.Client, now: s.now}, nil
}
