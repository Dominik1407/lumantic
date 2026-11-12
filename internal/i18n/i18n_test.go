package i18n

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestMessagesInEnglish(t *testing.T) {
	for de, want := range map[string]string{
		"Ungültige Frage.":                       "Invalid question.",
		`Das Thema "Risiko" gibt es nicht.`:      `The topic "Risiko" does not exist.`,
		"Mehr als 12 Kosmen sind nicht möglich.": "More than 12 Kosmen are not possible.",
		// What stood in for %s is translated too.
		"Kosmos alco: Die Kennzahl braucht einen Namen.":                                  "Kosmos alco: The key figure needs a name.",
		"Die Datenquelle ist nicht erreichbar: Die Datei C:/data/x.duckdb gibt es nicht.": "The data source cannot be reached: The file C:/data/x.duckdb does not exist.",
		"Die Definition kommt aus dem Fachkatalog und lässt sich nur dort ändern.":        "The definition comes from the company catalogue and can only be changed there.",
		"Umsatz: im Goldlayer fehlt gold.umsatz.":                                         "Umsatz: missing in the gold layer: gold.umsatz.",
		// Names, data and the messages of databases stay as they are.
		"Umsatz":                              "Umsatz",
		"Binder Error: column x not found":    "Binder Error: column x not found",
		"Die Zinsmarge ist gestiegen, warum?": "Die Zinsmarge ist gestiegen, warum?",
	} {
		if got := EN(de); got != want {
			t.Errorf("EN(%q)\n got %q\nwant %q", de, got, want)
		}
	}
}

func TestWhichLanguage(t *testing.T) {
	for _, c := range []struct {
		url, accept, cookie string
		en                  bool
	}{
		{"/api/me", "en", "", true},
		{"/api/me", "en-GB,de;q=0.8", "", true},
		{"/api/me", "de-CH,de;q=0.9,en;q=0.8", "", false},
		{"/api/me", "", "", false},
		{"/auth/callback", "de-CH", "en", true}, // the choice in Lumantic beats the browser's
		{"/api/events?lang=en", "de", "de", true},
		{"/api/events?lang=de", "en", "en", false},
	} {
		r := httptest.NewRequest("GET", c.url, nil)
		if c.accept != "" {
			r.Header.Set("Accept-Language", c.accept)
		}
		if c.cookie != "" {
			r.Header.Set("Cookie", Cookie+"="+c.cookie)
		}
		if got := Wants(r); got != c.en {
			t.Errorf("%s accept=%q cookie=%q: English %v, want %v", c.url, c.accept, c.cookie, got, c.en)
		}
	}
}

var verbRe = regexp.MustCompile(`%(\[\d+\])?[sqvwd]`)

func TestTableIsSound(t *testing.T) {
	seen := map[string]bool{}
	for _, m := range table {
		if seen[m[0]] {
			t.Errorf("twice in the table: %q", m[0])
		}
		seen[m[0]] = true
		de, en := verbRe.FindAllString(m[0], -1), verbRe.FindAllString(m[1], -1)
		if len(de) != len(en) {
			t.Errorf("%q has %d parts, its English %d", m[0], len(de), len(en))
		}
	}
}

// Every German message the server can send has its English. The test reads the
// code: a new message without a line in en.go fails here. The first board
// (engine, card, lumina's library, legacy.go) speaks German only.
func TestEveryMessageHasItsEnglish(t *testing.T) {
	call := regexp.MustCompile(`(?:errors\.New|fmt\.Errorf|fail\(w, \d+,|&NoFit\{Msg:|httpError\{\d+,)\s*"((?:[^"\\]|\\.)*)"`)
	german := regexp.MustCompile(`[äöüÄÖÜ]|\b(der|die|das|den|dem|und|ist|nicht|ein|eine|kein|keine|mit|von|zu|im|bis|nach|noch|sind|für|oder|Bitte|Ungültig\w*|Unbekannt\w*)\b`)
	skip := map[string]bool{"legacy.go": true}
	var files []string
	for _, dir := range []string{"server", "config", "metrics", "katalog", "auth", "adapter", "adapter/databricks", "adapter/snowflake", "source", "ai", "store", "beispiele"} {
		fs, _ := filepath.Glob(filepath.Join("..", dir, "*.go"))
		files = append(files, fs...)
	}
	if len(files) < 20 {
		t.Fatalf("found only %d files", len(files))
	}
	missing := 0
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") || skip[filepath.Base(f)] {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range call.FindAllStringSubmatch(string(src), -1) {
			format, err := strconv.Unquote(`"` + m[1] + `"`)
			if err != nil || !german.MatchString(format) {
				continue
			}
			sample := strings.NewReplacer("%q", `"x"`, "%d", "1", "%s", "x", "%v", "x", "%w", "x", "%%", "%").Replace(format)
			if strings.HasSuffix(format, ": ") {
				sample += "x" // the rest is added with +
			}
			if EN(sample) == sample {
				t.Errorf("%s: no English for %q", filepath.Base(f), format)
				missing++
			}
		}
	}
	if missing > 0 {
		t.Logf("%d messages without English; add them to en.go", missing)
	}
}
