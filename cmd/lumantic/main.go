// Command lumantic serves Lumantic: a calm surface over a team's gold layer.
// Settings come from config/lumantic.json, environment variables win over it
// (see config/README.md); tokens live in data/secrets.json.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"lumantic/internal/config"
	"lumantic/internal/lumina"
	"lumantic/internal/server"
	"lumantic/internal/store"
	"lumantic/web"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	cfg, err := config.Open(env("LUMANTIC_CONFIG", "config/lumantic.json"), env("LUMANTIC_SECRETS", "data/secrets.json"), nil)
	if err != nil {
		log.Fatal(err)
	}
	st, err := store.Open(env("LUMANTIC_DATA", "data/board.json"), lumina.StartBoard(), store.StartNotes)
	if err != nil {
		log.Fatal(err)
	}
	srv := &server.Server{Store: st, Config: cfg, UI: web.Dist()}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	srv.Start(ctx)
	cancel()

	where := cfg.Path()
	if !cfg.Exists() {
		where += " (noch nicht angelegt, es gelten die Standardwerte)"
	}
	addr := env("LUMANTIC_ADDR", "127.0.0.1:8080")
	log.Printf("Konfiguration: %s", where)
	for _, k := range srv.Kosmen() {
		log.Printf("Kosmos %s (%s, %s): %s", k.ID, k.Name, k.Type, k.Line())
	}
	// Kosmen are read again at the times of their schedules and when their files change.
	go srv.Schedule(context.Background())
	log.Printf("Lumantic läuft auf http://%s", addr)
	log.Fatal(http.ListenAndServe(addr, srv.Routes()))
}
