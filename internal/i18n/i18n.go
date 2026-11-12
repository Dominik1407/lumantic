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
	"strconv"
	"strings"
	"sync"
)

// Cookie is where the browser keeps the language the person chose, so that
// pages it opens itself (the login) speak it too.
const Cookie = "lumantic_lang"

// Wants says whether a request asks for English: ?lang=en, else the cookie,
// else the first language of Accept-Language.
func Wants(r *http.Request) bool {
	if r == nil {
		return false
	}
	if l := r.URL.Query().Get("lang"); l != "" {
		return isEn(l)
	}
	if c, err := r.Cookie(Cookie); err == nil && c.Value != "" {
		return isEn(c.Value)
	}
	first, _, _ := strings.Cut(r.Header.Get("Accept-Language"), ",")
	first, _, _ = strings.Cut(first, ";")
	return isEn(first)
}

func isEn(tag string) bool {
	tag = strings.ToLower(strings.TrimSpace(tag))
	return tag == "en" || strings.HasPrefix(tag, "en-")
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

type hole struct {
	verb byte // s, v, w, q or d
}

type pattern struct {
	re    *regexp.Regexp
	holes []hole
	out   string // the English format
	fixed int    // length of the literal text, to try the most specific first
}

var (
	once   sync.Once
	exact  map[string]string     // messages without holes
	byHead map[string][]*pattern // patterns by their first word
	loose  []*pattern            // patterns that begin with a hole
)

func compile() {
	exact, byHead = map[string]string{}, map[string][]*pattern{}
	for _, m := range table {
		de, out := m[0], m[1]
		if !strings.Contains(strings.ReplaceAll(de, "%%", ""), "%") {
			exact[strings.ReplaceAll(de, "%%", "%")] = out
			continue
		}
		p := build(de, out)
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

// head is the first word of a format, "" when it begins with a hole.
func head(f string) string {
	end := strings.IndexAny(f, " %")
	if end < 0 {
		return f
	}
	return f[:end]
}

func build(de, out string) *pattern {
	p := &pattern{out: out}
	var re strings.Builder
	re.WriteString(`(?s)^`)
	lit := func(s string) { re.WriteString(regexp.QuoteMeta(s)); p.fixed += len(s) }
	for i := 0; i < len(de); i++ {
		if de[i] != '%' || i+1 >= len(de) {
			end := strings.IndexByte(de[i+1:], '%')
			if end < 0 {
				end = len(de) - i - 1
			}
			lit(de[i : i+1+end])
			i += end
			continue
		}
		i++
		switch v := de[i]; v {
		case '%':
			lit("%")
		case 'q':
			re.WriteString(`("(?:[^"\\]|\\.)*")`)
			p.holes = append(p.holes, hole{v})
		case 'd':
			re.WriteString(`(-?\d+)`)
			p.holes = append(p.holes, hole{v})
		default: // s, v, w
			re.WriteString(`(.+?)`)
			p.holes = append(p.holes, hole{v})
		}
	}
	re.WriteString(`$`)
	p.re = regexp.MustCompile(re.String())
	return p
}

func en(s string, depth int) string {
	if s == "" || depth > 4 {
		return s
	}
	if out, ok := exact[s]; ok {
		return out
	}
	if !strings.ContainsAny(s, " :") {
		return s
	}
	for _, ps := range [][]*pattern{byHead[head(s)], loose} {
		for _, p := range ps {
			m := p.re.FindStringSubmatch(s)
			if m == nil {
				continue
			}
			args := make([]string, len(p.holes))
			for i, h := range p.holes {
				args[i] = m[i+1]
				if h.verb == 's' || h.verb == 'v' || h.verb == 'w' {
					args[i] = en(args[i], depth+1)
				}
			}
			return render(p.out, args)
		}
	}
	return s
}

// render fills an English format: each verb takes the next part, %[n]s the n-th.
func render(f string, args []string) string {
	var b strings.Builder
	next := 0
	for i := 0; i < len(f); i++ {
		if c := f[i]; c != '%' || i+1 >= len(f) {
			b.WriteByte(c)
			continue
		}
		i++
		if f[i] == '%' {
			b.WriteByte('%')
			continue
		}
		at := next
		if f[i] == '[' {
			if end := strings.IndexByte(f[i:], ']'); end > 0 {
				if n, err := strconv.Atoi(f[i+1 : i+end]); err == nil {
					at = n - 1
				}
				i += end + 1
			}
		} else {
			next++
		}
		if i < len(f) && at >= 0 && at < len(args) {
			b.WriteString(args[at])
		}
	}
	return b.String()
}
