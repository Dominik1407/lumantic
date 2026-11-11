package metrics

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"
)

// Days and weeks, the finer rasters. A week is an ISO 8601 week, Monday to
// Sunday. It is made from days only, never from months, because a week can lie
// in two months and the 29th of December 2025 already belongs to week 1 of
// 2026. The browser gets the days of the last 90 days and the weeks of the
// last two years; quarters and years it builds from the months itself.
const (
	DaysShown  = 90
	WeeksShown = 104
)

// Week is one ISO week of the calendar.
type Week struct {
	Key  string `json:"key"`  // 2026-W46
	From string `json:"from"` // its Monday
	To   string `json:"to"`   // its Sunday
}

func dayOf(s string) time.Time {
	t, _ := time.Parse(time.DateOnly, s)
	return t
}

// weekOf returns the ISO week of a day and its Monday.
func weekOf(t time.Time) (string, time.Time) {
	y, w := t.ISOWeek()
	return fmt.Sprintf("%d-W%02d", y, w), t.AddDate(0, 0, -((int(t.Weekday()) + 6) % 7))
}

// weeksOf lists every week from the first day's to the last day's, the last n
// of them.
func weeksOf(days []string, n int) []Week {
	if len(days) == 0 {
		return nil
	}
	_, first := weekOf(dayOf(days[0]))
	_, last := weekOf(dayOf(days[len(days)-1]))
	var out []Week
	for m := first; !m.After(last); m = m.AddDate(0, 0, 7) {
		key, _ := weekOf(m)
		out = append(out, Week{Key: key, From: m.Format(time.DateOnly), To: m.AddDate(0, 0, 6).Format(time.DateOnly)})
	}
	if len(out) > n {
		out = out[len(out)-n:]
	}
	return out
}

// recent is the index of the first of days that lies within the last n days.
func recent(days []string, n int) int {
	if len(days) == 0 {
		return 0
	}
	cut := dayOf(days[len(days)-1]).AddDate(0, 0, -(n - 1)).Format(time.DateOnly)
	return sort.SearchStrings(days, cut)
}

// sumUp adds the values of one period up by kind: the last day with a value
// for a balance, the sum for a flow, the mean for an average. A period without
// any value stays empty: a day without a row is never zero.
func sumUp(kind string, vals []*float64) *float64 {
	n, s, last := 0, 0.0, 0.0
	for _, v := range vals {
		if v != nil {
			n, s, last = n+1, s+*v, *v
		}
	}
	switch {
	case n == 0:
		return nil
	case kind == "flow":
		return &s
	case kind == "avg" || kind == "ratio":
		m := s / float64(n)
		return &m
	}
	return &last
}

// byWeek groups the values of the days into their weeks.
func byWeek(days []string, weeks []Week, vals []*float64) [][]*float64 {
	at := make(map[string]int, len(weeks))
	for i, w := range weeks {
		at[w.Key] = i
	}
	out := make([][]*float64, len(weeks))
	for i, d := range days {
		key, _ := weekOf(dayOf(d))
		if j, ok := at[key]; ok && i < len(vals) {
			out[j] = append(out[j], vals[i])
		}
	}
	return out
}

func weekly(days []string, weeks []Week, vals []*float64, kind string) []*float64 {
	groups := byWeek(days, weeks, vals)
	out := make([]*float64, len(weeks))
	for j, g := range groups {
		out[j] = sumUp(kind, g)
	}
	return out
}

// ratioOf divides a ratio's parts week by week, each added up by its own kind,
// in the ratio's own scale.
func ratioOf(days []string, weeks []Week, vals, num, den []*float64, partsKind string) []*float64 {
	scale := ratioScale(vals, num, den)
	n, d := weekly(days, weeks, num, partsKind), weekly(days, weeks, den, partsKind)
	out := make([]*float64, len(weeks))
	for j := range out {
		if n[j] != nil && d[j] != nil && *d[j] != 0 {
			v := *n[j] / *d[j] * scale
			out[j] = &v
		}
	}
	return out
}

// ratioScale is the factor between a ratio and its parts, 100 for a
// percentage, read from the data: the median of value ÷ (numerator ÷
// denominator), taken as a power of ten when it is close to one.
func ratioScale(vals, num, den []*float64) float64 {
	var xs []float64
	for i := range vals {
		if i < len(num) && i < len(den) && vals[i] != nil && num[i] != nil && den[i] != nil && *num[i] != 0 && *den[i] != 0 {
			xs = append(xs, *vals[i]/(*num[i] / *den[i]))
		}
	}
	if len(xs) == 0 {
		return 1
	}
	sort.Float64s(xs)
	med := xs[len(xs)/2]
	if med == 0 {
		return 1
	}
	ten := math.Pow(10, math.Round(math.Log10(math.Abs(med))))
	if math.Abs(med/ten-1) < 0.02 {
		return ten
	}
	return med
}

// Phasings say how the annual target of a flow spreads over the months. The
// standard of controlling is "monate": a twelfth for each month, and within
// the month the same for every working day. "arbeitstage" spreads the year by
// the working days of each month, "kalendertage" by all its days, and
// "profil" by twelve weights of one's own (more at the end of a quarter).
var Phasings = map[string]bool{"": true, "monate": true, "arbeitstage": true, "kalendertage": true, "profil": true}

func daysIn(y int, m time.Month) int { return time.Date(y, m+1, 0, 0, 0, 0, 0, time.UTC).Day() }

// workdays counts Monday to Friday. Holidays differ by canton and follow later.
func workdays(y int, m time.Month) int {
	n := 0
	for d := 1; d <= daysIn(y, m); d++ {
		if wd := time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Weekday(); wd != time.Saturday && wd != time.Sunday {
			n++
		}
	}
	return n
}

// monthShare is the part of an annual target that falls on one month.
func monthShare(y int, m time.Month, phasing string, profile []float64) float64 {
	of := func(f func(time.Month) int) float64 {
		all := 0
		for x := time.January; x <= time.December; x++ {
			all += f(x)
		}
		return float64(f(m)) / float64(all)
	}
	switch phasing {
	case "arbeitstage":
		return of(func(x time.Month) int { return workdays(y, x) })
	case "kalendertage":
		return of(func(x time.Month) int { return daysIn(y, x) })
	case "profil":
		if len(profile) == 12 {
			s := 0.0
			for _, w := range profile {
				s += w
			}
			if s > 0 {
				return profile[m-1] / s
			}
		}
	}
	return 1.0 / 12
}

// toMonth converts a flow's target to one month: an annual one by its share,
// a monthly one as it is. month is YYYY-MM.
func toMonth(v float64, per, month, phasing string, profile []float64) float64 {
	if per != "jahr" || len(month) < 7 {
		return v
	}
	y, _ := strconv.Atoi(month[:4])
	m, _ := strconv.Atoi(month[5:7])
	return v * monthShare(y, time.Month(m), phasing, profile)
}

// phasingOf is the figure's phasing, the file's, or the standard.
func phasingOf(k Def, c *Config) string {
	switch {
	case k.Phasing != "":
		return k.Phasing
	case len(k.Profile) == 12:
		return "profil"
	case c.Phasing != "":
		return c.Phasing
	}
	return "monate"
}

// checkPhasing checks how a figure's target spreads over the year.
func checkPhasing(id, per, phasing string, profile []float64) error {
	switch {
	case per != "" && per != "monat" && per != "jahr":
		return fmt.Errorf("Kennzahl %s: targetPer muss monat oder jahr sein", id)
	case !Phasings[phasing]:
		return fmt.Errorf("Kennzahl %s: phasing muss monate, arbeitstage, kalendertage oder profil sein", id)
	case (phasing == "profil" || len(profile) > 0) && len(profile) != 12:
		return fmt.Errorf("Kennzahl %s: ein Profil braucht zwölf Gewichte, eines pro Monat", id)
	}
	sum := 0.0
	for _, w := range profile {
		if w < 0 {
			return fmt.Errorf("Kennzahl %s: die Gewichte eines Profils dürfen nicht negativ sein", id)
		}
		sum += w
	}
	if len(profile) == 12 && sum == 0 {
		return fmt.Errorf("Kennzahl %s: ein Profil braucht mindestens ein Gewicht über null", id)
	}
	return nil
}
