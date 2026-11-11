// Command lumantic serves Lumantic: a calm surface over a team's gold layer.
// Settings come from config/lumantic.json, environment variables win over it
// (see config/README.md); tokens live in data/secrets.json.
package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"lumantic/internal/auth"
	"lumantic/internal/config"
	"lumantic/internal/lumina"
	"lumantic/internal/server"
	"lumantic/internal/store"
	"lumantic/web"
)

// loopback says whether an address listens only on this machine.
func loopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

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
	srv := &server.Server{Store: st, Config: cfg, UI: web.Dist(), AccessLog: env("LUMANTIC_ACCESS_LOG", "data/zugriff.log")}
	eff := cfg.Effective()
	if err := config.ValidateAuth(eff.Auth); err != nil {
		log.Fatalf("Anmeldung: %v", err)
	}
	secret, _, _ := cfg.Secret(config.OIDCSecret)
	login, err := auth.New(eff.Auth, auth.Options{Secret: secret, Log: srv.Noted})
	if err != nil {
		log.Fatalf("Anmeldung: %v", err)
	}
	srv.Auth = login
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	srv.Start(ctx)
	cancel()

	where := cfg.Path()
	if !cfg.Exists() {
		where += " (noch nicht angelegt, es gelten die Standardwerte)"
	}
	addr := env("LUMANTIC_ADDR", "127.0.0.1:8080")
	// Without a login everyone who reaches Lumantic may change everything, so it
	// then listens only on this machine.
	if login.Kind() == "none" && !loopback(addr) && os.Getenv("LUMANTIC_OPEN") == "" {
		log.Fatalf("Ohne Anmeldung hört Lumantic nur auf diesem Rechner. %s wäre von aussen erreichbar: Richte unter «auth» eine Anmeldung ein (proxy oder oidc, siehe config/README.md) oder setz LUMANTIC_ADDR auf 127.0.0.1:8080.", addr)
	}
	log.Printf("Anmeldung: %s", map[string]string{"none": "keine, nur dieser Rechner", "proxy": "über den Proxy davor", "oidc": "OpenID Connect, " + eff.Auth.OIDC.Issuer}[login.Kind()])
	log.Printf("Konfiguration: %s", where)
	for _, k := range srv.Kosmen() {
		log.Printf("Kosmos %s (%s, %s): %s", k.ID, k.Name, k.Type, k.Line())
	}
	// Kosmen are read again at the times of their schedules and when their files change.
	go srv.Schedule(context.Background())
	log.Printf("Lumantic läuft auf http://%s", addr)
	log.Fatal(http.ListenAndServe(addr, srv.Routes()))
}
