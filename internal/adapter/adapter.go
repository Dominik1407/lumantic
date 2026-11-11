// Package adapter is the only place that knows what runs below Lumantic.
// Every adapter offers the same two plugs: Describe ("what is there?") and
// Query ("compute this"). Swapping the platform means swapping the adapter.
package adapter

import (
	"context"

	"github.com/Dominik1407/lumantic/internal/catalog"
)

type Row map[string]any

type Adapter interface {
	Name() string
	// Dialect tells the SQL compiler which SQL flavour to write.
	Dialect() string
	Describe(ctx context.Context) (*catalog.Catalog, error)
	Query(ctx context.Context, sql string) ([]Row, error)
}

// Watcher is an adapter that can tell cheaply whether its data changed,
// without asking a database: Mark returns a short text that changes whenever
// the data does, such as the newest file time.
type Watcher interface {
	Mark(ctx context.Context) (string, error)
}

// Person is someone a database is asked for in their own name: their account
// and an access token of their login.
type Person struct {
	ID    string
	Token string
}

// OnBehalf is an adapter that can ask in a person's name (Weg 2): the copy it
// returns reads with the person's login, so the database's own rights apply.
type OnBehalf interface {
	As(ctx context.Context, p Person) (Adapter, error)
}

// Float reads a numeric cell; JSON numbers arrive as float64.
func Float(r Row, key string) (float64, bool) {
	switch v := r[key].(type) {
	case float64:
		return v, true
	case int64:
		return float64(v), true
	}
	return 0, false
}

func String(r Row, key string) string {
	if s, ok := r[key].(string); ok {
		return s
	}
	return ""
}
