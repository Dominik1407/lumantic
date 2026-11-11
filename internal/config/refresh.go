package config

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Refresh says when Lumantic reads a Kosmos again by itself. A loading job can
// always ask for it as well, with the Kosmos's refresh token (RefreshToken).
type Refresh struct {
	Daily []string `json:"daily"` // times of day, "06:30", in the server's time zone
	Watch int      `json:"watch"` // minutes between looks at the files; 0 = never
}

// Watchable says whether Lumantic can see changes of a source without asking
// the database: files on disk can, a warehouse cannot without waking it.
func Watchable(kind string) bool { return kind == "duckdb" || kind == "files" }

// RefreshOf is the schedule that applies to a source: the one written down,
// else the usual one for its kind. Files are watched every five minutes; a
// warehouse is read once a day, early, so it wakes once.
func RefreshOf(d Data, r *Refresh) Refresh {
	if r != nil {
		out := Refresh{Daily: append([]string{}, r.Daily...), Watch: r.Watch}
		if !Watchable(d.Type) {
			out.Watch = 0
		}
		return out
	}
	if Watchable(d.Type) {
		return Refresh{Daily: []string{}, Watch: 5}
	}
	return Refresh{Daily: []string{"06:00"}}
}

var clockRe = regexp.MustCompile(`^(\d{1,2}):(\d{2})$`)

// normalizeRefresh writes times as "06:30", sorted and once each. Watching is
// dropped for sources that cannot be watched.
func normalizeRefresh(r *Refresh, d Data) {
	if r == nil {
		return
	}
	seen := map[string]bool{}
	daily := []string{}
	for _, t := range r.Daily {
		t = strings.TrimSpace(t)
		if m := clockRe.FindStringSubmatch(t); m != nil && len(m[1]) == 1 {
			t = "0" + t
		}
		if t != "" && !seen[t] {
			seen[t] = true
			daily = append(daily, t)
		}
	}
	sort.Strings(daily)
	r.Daily = daily
	if !Watchable(d.Type) {
		r.Watch = 0
	}
}

// ValidateRefresh checks a schedule. Messages are for people.
func ValidateRefresh(r Refresh) error {
	if len(r.Daily) > 8 {
		return errors.New("Höchstens acht Zeiten am Tag.")
	}
	for _, t := range r.Daily {
		m := clockRe.FindStringSubmatch(t)
		var h, min int
		if m != nil {
			fmt.Sscanf(t, "%d:%d", &h, &min)
		}
		if m == nil || h > 23 || min > 59 {
			return fmt.Errorf("«%s» ist keine Uhrzeit. Zeiten im Format 06:30.", t)
		}
	}
	if r.Watch < 0 || r.Watch > 1440 {
		return errors.New("Auf Änderungen schauen geht alle 1 bis 1440 Minuten.")
	}
	return nil
}
