// Command lumantic serves Lumantic: a calm surface over a team's gold layer.
//
// Where it keeps settings and data: with LUMANTIC_CONFIG, or in a folder that
// holds config/lumantic.json (a source checkout), everything stays relative to
// the working folder as before. Otherwise in LUMANTIC_HOME (the container sets
// /data), else in the person's settings folder (%AppData%\Lumantic,
// ~/Library/Application Support/Lumantic, ~/.config/lumantic). Environment
// variables win over the settings (see config/README.md).
//
// A first start without settings shows the examples (internal/beispiele).
//
//	lumantic          start
//	lumantic health   ask a running Lumantic whether it is well (for containers)
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/Dominik1407/lumantic/internal/auth"
	"github.com/Dominik1407/lumantic/internal/beispiele"
	"github.com/Dominik1407/lumantic/internal/config"
	"github.com/Dominik1407/lumantic/internal/lumina"
	"github.com/Dominik1407/lumantic/internal/server"
	"github.com/Dominik1407/lumantic/internal/store"
	"github.com/Dominik1407/lumantic/web"
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

// home finds the folder for settings and data, or "" for a source checkout or
// an explicit LUMANTIC_CONFIG, where paths stay as they are.
func home() (string, error) {
	if os.Getenv("LUMANTIC_CONFIG") != "" {
		return "", nil
	}
	if _, err := os.Stat(filepath.Join("config", "lumantic.json")); err == nil {
		return "", nil
	}
	if h := os.Getenv("LUMANTIC_HOME"); h != "" {
		return filepath.Abs(h)
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("Lumantic findet keinen Ordner für seine Daten: %w. Setz LUMANTIC_HOME.", err)
	}
	name := "Lumantic"
	if runtime.GOOS == "linux" {
		name = "lumantic"
	}
	return filepath.Join(dir, name), nil
}

// fromEnv says whether the environment names the first Kosmos's data source.
func fromEnv(cfg *config.Manager) bool {
	for _, l := range cfg.Locked() {
		if strings.HasPrefix(l, "data.") && l != "data.duckdb" {
			return true
		}
	}
	return false
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "health" {
		os.Exit(health())
	}
	dir, err := home()
	if err != nil {
		log.Fatal(err)
	}
	// In its own folder Lumantic keeps everything side by side, and paths in the
	// settings are read from there.
	cfgPath, secretsPath, boardPath, accessPath := "config/lumantic.json", "data/secrets.json", "data/board.json", "data/zugriff.log"
	if dir != "" {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Fatal(err)
		}
		if err := os.Chdir(dir); err != nil {
			log.Fatal(err)
		}
		cfgPath, secretsPath, boardPath, accessPath = filepath.Join(dir, "lumantic.json"), filepath.Join(dir, "secrets.json"),
			filepath.Join(dir, "board.json"), filepath.Join(dir, "zugriff.log")
	}
	cfg, err := config.Open(env("LUMANTIC_CONFIG", cfgPath), env("LUMANTIC_SECRETS", secretsPath), nil)
	if err != nil {
		log.Fatal(err)
	}
	// The very first start shows the examples; one's own gold layer comes in through the settings.
	if dir != "" && !cfg.Exists() && !fromEnv(cfg) {
		cfg.Begin(beispiele.Config("beispiele"))
	}
	writeExamples(cfg.Effective())
	// A Lumantic that runs for days writes them anew each day; the folders are watched, so the Kosmen follow.
	go func() {
		for range time.Tick(time.Hour) {
			writeExamples(cfg.Effective())
		}
	}()

	st, err := store.Open(env("LUMANTIC_DATA", boardPath), lumina.StartBoard(), store.StartNotes)
	if err != nil {
		log.Fatal(err)
	}
	srv := &server.Server{Store: st, Config: cfg, UI: web.Dist(), AccessLog: env("LUMANTIC_ACCESS_LOG", accessPath)}
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

	addr, fixed := os.LookupEnv("LUMANTIC_ADDR")
	if !fixed || addr == "" {
		addr, fixed = "127.0.0.1:8080", false
	}
	// Without a login everyone who reaches Lumantic may change everything. So it
	// listens only on this machine, or, open to others, shows only the examples.
	if login.Kind() == "none" && !loopback(addr) && os.Getenv("LUMANTIC_OPEN") == "" {
		if !eff.Examples() {
			log.Fatalf("Ohne Anmeldung hört Lumantic nur auf diesem Rechner. %s wäre von aussen erreichbar: Richte unter «auth» eine Anmeldung ein (proxy oder oidc, siehe config/README.md), setz LUMANTIC_ADDR auf 127.0.0.1:8080 oder, wenn du das willst, LUMANTIC_OPEN=1.", addr)
		}
		srv.ExamplesOnly = true
		log.Printf("Ohne Anmeldung zeigt Lumantic hier nur die Beispiele. Für eigene Daten richte eine Anmeldung ein oder setz LUMANTIC_OPEN=1.")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	srv.Start(ctx)
	cancel()

	where := cfg.Path()
	if !cfg.Exists() {
		where += " (noch nicht angelegt, es gelten die Standardwerte)"
	}
	log.Printf("Anmeldung: %s", map[string]string{"none": "keine, nur dieser Rechner", "proxy": "über den Proxy davor", "oidc": "OpenID Connect, " + eff.Auth.OIDC.Issuer}[login.Kind()])
	if dir != "" {
		log.Printf("Daten: %s", dir)
	}
	log.Printf("Konfiguration: %s", where)
	for _, k := range srv.Kosmen() {
		log.Printf("Kosmos %s (%s, %s): %s", k.ID, k.Name, k.Type, k.Line())
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil && !fixed {
		// 8080 is taken: any free port on this machine will do.
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		log.Fatalf("Lumantic kann nicht auf %s hören: %v", addr, err)
	}
	url := "http://" + ln.Addr().String()
	// Kosmen are read again at the times of their schedules and when their files change.
	go srv.Schedule(context.Background())
	fmt.Printf("\n  Lumantic läuft auf %s · Beenden mit Ctrl+C oder durch Schliessen dieses Fensters.\n  Lumantic is running at %s · Stop it with Ctrl+C or by closing this window.\n\n", url, url)
	if dir != "" && loopback(ln.Addr().String()) && os.Getenv("LUMANTIC_BROWSER") != "0" {
		go openBrowser(url)
	}
	log.Fatal(http.Serve(ln, srv.Routes()))
}

// writeExamples writes the examples of the day where the settings expect them;
// beispiele.Write does nothing when they are already today's.
func writeExamples(c config.Config) {
	dirs := map[string]bool{}
	for _, d := range c.Sources() {
		if d.Example {
			dirs[filepath.Dir(d.Path)] = true
		}
	}
	for d := range dirs {
		if err := beispiele.Write(d, time.Now()); err != nil {
			log.Printf("Beispiele: %v", err)
		}
	}
}

// openBrowser shows Lumantic in the person's browser; LUMANTIC_BROWSER=0 keeps it closed.
func openBrowser(url string) {
	time.Sleep(300 * time.Millisecond)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err == nil {
		go cmd.Wait()
	}
}

// health asks the Lumantic on this machine whether it runs; 0 when it does.
func health() int {
	addr := env("LUMANTIC_ADDR", "127.0.0.1:8080")
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	c := http.Client{Timeout: 3 * time.Second}
	res, err := c.Get("http://127.0.0.1:" + port + "/healthz")
	if err == nil {
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			err = errors.New(res.Status)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Lumantic antwortet nicht:", err)
		return 1
	}
	return 0
}
