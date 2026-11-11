package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Dominik1407/lumantic/internal/catalog"
)

// Windmill calls two Windmill scripts that run on the team's gold layer:
// one returns the catalog, one runs a read-only query and returns rows.
// Templates for both scripts live in adapters/windmill/.
type Windmill struct {
	BaseURL      string // e.g. https://windmill.example.ch
	Workspace    string
	Token        string // a Windmill token with run permission on both scripts
	DescribePath string // e.g. f/lumantic/describe
	QueryPath    string // e.g. f/lumantic/query
	Client       *http.Client
}

func (w *Windmill) Name() string    { return "windmill" }
func (w *Windmill) Dialect() string { return "duckdb" }

func (w *Windmill) run(ctx context.Context, path string, args any, out any) error {
	body, _ := json.Marshal(args)
	url := fmt.Sprintf("%s/api/w/%s/jobs/run_wait_result/p/%s", strings.TrimRight(w.BaseURL, "/"), w.Workspace, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+w.Token)
	req.Header.Set("Content-Type", "application/json")
	client := w.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("windmill: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("windmill %s: %s: %s", path, resp.Status, strings.TrimSpace(string(data)))
	}
	return json.Unmarshal(data, out)
}

func (w *Windmill) Describe(ctx context.Context) (*catalog.Catalog, error) {
	var cat catalog.Catalog
	if err := w.run(ctx, w.DescribePath, map[string]any{}, &cat); err != nil {
		return nil, err
	}
	cat.Dialect = w.Dialect()
	for ti := range cat.Tables {
		for ci := range cat.Tables[ti].Columns {
			c := &cat.Tables[ti].Columns[ci]
			if c.Role == "" {
				c.Role = catalog.RoleFor(c.Type)
			}
			if c.Unit == "" {
				c.Unit = catalog.UnitFor(c.Name)
			}
		}
	}
	return &cat, nil
}

func (w *Windmill) Query(ctx context.Context, sql string) ([]Row, error) {
	var rows []Row
	err := w.run(ctx, w.QueryPath, map[string]any{"sql": sql}, &rows)
	return rows, err
}
