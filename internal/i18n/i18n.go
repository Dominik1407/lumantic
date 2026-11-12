// Package i18n puts Lumantic's own messages into English. The code writes them
// in German, as format strings; the table in en.go holds each one in English
// with the same verbs. A message that comes out of fmt.Errorf("… %s …", x) is
// found again by its pattern, and what stood in for %s is translated as well,
// so «Kosmos alco: Die Kennzahl braucht einen Namen.» reads «Kosmos alco: The
// key figure needs a name.». What is not in the table stays as it is: names,
// data, and the messages of databases and providers.
//
// Lumantic translates only its own texts. What a team defines (names of
// figures, topics, words) it writes in English itself, in the «en» fields.
package i18n

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// Cookie is where the browser keeps the language the person chose, so that
// pages it opens itself (the login) speak it too.
const Cookie = "lumantic_lang"

// Wants says whether a request asks for English: ?lang=en, else the cookie,
// else the browser's first language unless it is German, as the interface
// decides (web/src/i18n.ts). Without any of them Lumantic speaks German.
func Wants(r *http.Request) bool {
	if r == nil {
		return false
	}
	if l := r.URL.Query().Get("lang"); l != "" {
		return l == "en"
	}
	if c, err := r.Cookie(Cookie); err == nil && c.Value != "" {
		return c.Value == "en"
	}
	first, _, _ := strings.Cut(r.Header.Get("Accept-Language"), ",")
	first, _, _ = strings.Cut(first, ";")
	first = strings.ToLower(strings.TrimSpace(first))
	return first != "" && !strings.HasPrefix(first, "de")
}

// Lang is the language a request asks for, "de" or "en".
func Lang(r *http.Request) string {
	if Wants(r) {
		return "en"
	}
	return "de"
}

// Text is s in the language the request asks for.
func Text(r *http.Request, s string) string {
	if Wants(r) {
		return EN(s)
	}
	return s
}

// EN is s in English, when s is one of Lumantic's messages; else s.
func EN(s string) string {
	once.Do(compile)
	return en(s, 0)
}

type pattern struct {
	re    *regexp.Regexp
	out   []string // the English format, cut at its parts
	fixed int      // length of the literal text, to try the most specific first
}

var (
	once   sync.Once
	exact  map[string]string     // messages without parts
	byHead map[string][]*pattern // patterns by their first word
	loose  []*pattern            // patterns that begin with a part
)

var verb = regexp.MustCompile(`%[sqvwd]`)

func compile() {
	exact, byHead = map[string]string{}, map[string][]*pattern{}
	for _, m := range table {
		de, out := m[0], m[1]
		if !verb.MatchString(de) {
			exact[strings.ReplaceAll(de, "%%", "%")] = out
			continue
		}
		lits := verb.Split(de, -1)
		p := &pattern{out: verb.Split(out, -1)}
		for i := range p.out {
			p.out[i] = strings.ReplaceAll(p.out[i], "%%", "%")
		}
		for i := range lits {
			lits[i] = strings.ReplaceAll(lits[i], "%%", "%")
			p.fixed += len(lits[i])
			lits[i] = regexp.QuoteMeta(lits[i])
		}
		p.re = regexp.MustCompile(`(?s)^` + strings.Join(lits, `(.+?)`) + `$`)
		if h := head(de); h != "" {
			byHead[h] = append(byHead[h], p)
		} else {
			loose = append(loose, p)
		}
	}
	for _, ps := range byHead {
		sort.SliceStable(ps, func(i, j int) bool { return ps[i].fixed > ps[j].fixed })
	}
	sort.SliceStable(loose, func(i, j int) bool { return loose[i].fixed > loose[j].fixed })
}

// head is the first word of a format, "" when it begins with a part.
func head(f string) string {
	end := strings.IndexAny(f, " %")
	if end < 0 {
		return f
	}
	return f[:end]
}

func en(s string, depth int) string {
	if s == "" || depth > 4 {
		return s
	}
	if out, ok := exact[s]; ok {
		return out
	}
	// A name, a number or a quoted word: nothing of Lumantic's to translate.
	if !strings.ContainsAny(s, " :") {
		return s
	}
	for _, ps := range [][]*pattern{byHead[head(s)], loose} {
		for _, p := range ps {
			m := p.re.FindStringSubmatch(s)
			if m == nil {
				continue
			}
			var b strings.Builder
			for i, lit := range p.out {
				b.WriteString(lit)
				if i+1 < len(m) && i+1 < len(p.out) {
					b.WriteString(en(m[i+1], depth+1))
				}
			}
			return b.String()
		}
	}
	return s
}
