package main

import (
	"math"
	"time"
)

// The Musterwerk's days: good parts per plant and the scrap of the whole group,
// every working day from November 2024 to Tuesday, 10 November 2026. Each
// month's days add up to its monthly figures exactly; November is still running
// and follows October. On the Monday and Tuesday of week 46 a press in Brno
// stands still, so the running week falls behind its plan.
func industrieDaily(r *mulberry, gut [3][]float64, gesamt, aus []float64) []table {
	f0 := func(v float64) string { return ftoa(math.Round(v), 0) }
	f2 := func(v float64) string { return ftoa(v, 2) }
	werke := []string{"Aarau", "Brno", "Suzhou"}
	weekday := map[time.Weekday]float64{time.Monday: 0.96, time.Tuesday: 1.02, time.Wednesday: 1.03, time.Thursday: 1.02, time.Friday: 0.97}
	last := time.Date(2026, 11, 10, 0, 0, 0, 0, time.UTC)

	// The working days of each month, and a weight for each: the weekday's rhythm and some noise.
	type month struct {
		t    int
		days []time.Time
	}
	var months []month
	for d := time.Date(2024, 11, 1, 0, 0, 0, 0, time.UTC); !d.After(last); d = d.AddDate(0, 0, 1) {
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			continue
		}
		t := ym(d.Year(), int(d.Month()))
		if len(months) == 0 || months[len(months)-1].t != t {
			months = append(months, month{t: t})
		}
		months[len(months)-1].days = append(months[len(months)-1].days, d)
	}
	// spread splits a month's total over its days; a month without a total (November) goes on at October's pace.
	spread := func(total []float64, m month, noise float64) []float64 {
		w, sum := make([]float64, len(m.days)), 0.0
		for i, d := range m.days {
			w[i] = weekday[d.Weekday()] * (1 + (r.next()*2-1)*noise)
			sum += w[i]
		}
		t, per := m.t, 0.0
		if t >= len(total) {
			t = len(total) - 1
			per = total[t] / float64(workdaysOf(t))
		}
		out := make([]float64, len(w))
		for i := range w {
			if per > 0 {
				out[i] = per * w[i]
			} else {
				out[i] = total[t] * w[i] / sum
			}
		}
		return out
	}

	prod := table{name: "produktion_tag", desc: "Gefertigte Gutteile pro Arbeitstag und Werk",
		cols: []column{{"tag", "DATE", "Arbeitstag"}, {"werk", "VARCHAR", "Werk"}, {"gutteile_stk", "DOUBLE", "Fehlerfreie Teile"}}}
	qual := table{name: "qualitaet_tag", desc: "Ausschuss der ganzen Gruppe pro Arbeitstag",
		cols: []column{{"tag", "DATE", "Arbeitstag"}, {"ausschussquote_pct", "DOUBLE", "Ausschuss in Prozent der gefertigten Teile"},
			{"ausschuss_stk", "DOUBLE", "Teile mit Fehler"}, {"gesamt_stk", "DOUBLE", "Gefertigte Teile insgesamt"}}}
	for _, m := range months {
		byWerk := [3][]float64{spread(gut[0], m, 0.08), spread(gut[1], m, 0.08), spread(gut[2], m, 0.08)}
		ges, scrap := spread(gesamt, m, 0.06), spread(aus, m, 0.3)
		for i, d := range m.days {
			day := d.Format("2006-01-02")
			for j, w := range werke {
				v := byWerk[j][i]
				if w == "Brno" && d.Year() == 2026 && d.Month() == time.November && d.Day() >= 9 {
					v *= 0.38 // the press stands still
				}
				prod.rows = append(prod.rows, []string{day, w, f0(v)})
			}
			qual.rows = append(qual.rows, []string{day, f2(scrap[i] / ges[i] * 100), f0(scrap[i]), f0(ges[i])})
		}
	}
	return []table{prod, qual}
}

// workdaysOf counts Monday to Friday in month t.
func workdaysOf(t int) int {
	first := time.Date(2019, time.Month(1+t), 1, 0, 0, 0, 0, time.UTC)
	n := 0
	for d := first; d.Month() == first.Month(); d = d.AddDate(0, 0, 1) {
		if d.Weekday() != time.Saturday && d.Weekday() != time.Sunday {
			n++
		}
	}
	return n
}
