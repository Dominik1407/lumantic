package beispiele

import (
	"math"
	"time"
)

// The demo ALCO gold layer: regulatory ratios, balance sheet, net new money and
// the mortgage pipeline, monthly from January 2019 to October 2026 in story
// time, plus daily values since September 2026 (story.go places them in real
// time). The monthly series reproduce the design study (design/03-uhrwerk.html)
// number for number: same seed, same generator.

const alcoMonths = 94

// mulberry32, bit for bit like the JavaScript version in the design study.
type mulberry struct{ s uint32 }

func (m *mulberry) next() float64 {
	m.s += 0x6d2b79f5
	t := (m.s ^ (m.s >> 15)) * (1 | m.s)
	t = (t + (t^(t>>7))*(61|t)) ^ t
	return float64(t^(t>>14)) / 4294967296
}

type key struct {
	t int
	v float64
}

// keys interpolates between keyframes with smoothstep and adds seeded noise;
// from quietFrom on the values are exact.
func keys(r *mulberry, points []key, noise float64, quietFrom int) []float64 {
	out := make([]float64, alcoMonths)
	for t := 0; t < alcoMonths; t++ {
		k := 0
		for k < len(points)-2 && t > points[k+1].t {
			k++
		}
		p0, p1 := points[k], points[k+1]
		f := 0.0
		if p1.t != p0.t {
			f = math.Max(0, math.Min(1, float64(t-p0.t)/float64(p1.t-p0.t)))
		}
		n := (r.next()*2 - 1) * noise
		out[t] = p0.v + (p1.v-p0.v)*f*f*(3-2*f)
		if t < quietFrom {
			out[t] += n
		}
	}
	return out
}

func flows(r *mulberry, base, amp float64, overrides [][3]float64) []float64 {
	out := make([]float64, alcoMonths)
	for t := range out {
		out[t] = base + (r.next()*2-1)*amp
	}
	for _, o := range overrides {
		out[ym(int(o[0]), int(o[1]))] = o[2]
	}
	return out
}

type alcoSeries struct {
	lcr, outflow, hqla, nsfr, cet1, lev, eve, nim, bal []float64
	save, curr, term, dep, mort                        []float64
	nnm                                                [3][]float64 // Privatkunden, Vermögensverwaltung, Firmenkunden
	pipe                                               [3][]float64 // Anfrage, Offerte, Zusage
}

var (
	segments = []string{"Privatkunden", "Vermögensverwaltung", "Firmenkunden"}
	stages   = []string{"Anfrage", "Offerte", "Zusage"}
)

func generateALCO() alcoSeries {
	r := &mulberry{s: 1914}
	q := alcoMonths
	var s alcoSeries
	s.lcr = keys(r, []key{{0, 142}, {ym(2019, 12), 144}, {ym(2020, 2), 143}, {ym(2020, 6), 162}, {ym(2021, 1), 168}, {ym(2021, 6), 158}, {ym(2021, 12), 150},
		{ym(2022, 6), 146}, {ym(2022, 12), 140}, {ym(2023, 2), 141}, {ym(2023, 3), 155}, {ym(2023, 6), 147}, {ym(2023, 12), 144}, {ym(2024, 12), 141},
		{ym(2025, 12), 135}, {ym(2026, 6), 130}, {ym(2026, 7), 127}, {ym(2026, 8), 124}, {ym(2026, 9), 121}, {ym(2026, 10), 118}}, 1.6, ym(2026, 6))
	s.outflow = keys(r, []key{{0, 2600}, {ym(2026, 6), 3020}, {ym(2026, 10), 3210}}, 18, ym(2026, 6))
	s.hqla = make([]float64, q)
	for t := range s.hqla {
		s.hqla[t] = s.lcr[t] * s.outflow[t] / 100
	}
	s.nsfr = keys(r, []key{{0, 121}, {ym(2020, 6), 128}, {ym(2021, 6), 126}, {ym(2022, 12), 120}, {ym(2023, 6), 122}, {ym(2024, 12), 123}, {ym(2025, 12), 120}, {ym(2026, 10), 117}}, 0.7, ym(2026, 9))
	s.cet1 = keys(r, []key{{0, 15.1}, {ym(2024, 12), 16.6}, {ym(2025, 1), 16.1}, {ym(2026, 10), 16.3}}, 0.07, q)
	s.lev = keys(r, []key{{0, 6.3}, {ym(2020, 3), 6.35}, {ym(2020, 6), 6.0}, {ym(2021, 6), 6.4}, {ym(2026, 10), 6.9}}, 0.04, q)
	s.eve = keys(r, []key{{0, 9.0}, {ym(2021, 6), 10.5}, {ym(2022, 9), 8.2}, {ym(2024, 6), 10.8}, {ym(2025, 12), 12.1}, {ym(2026, 6), 12.6},
		{ym(2026, 7), 12.7}, {ym(2026, 8), 12.8}, {ym(2026, 9), 12.9}, {ym(2026, 10), 13.2}}, 0.18, ym(2026, 6))
	s.nim = keys(r, []key{{0, 1.08}, {ym(2021, 12), 1.02}, {ym(2022, 9), 1.1}, {ym(2023, 9), 1.38}, {ym(2024, 6), 1.3}, {ym(2025, 6), 1.12}, {ym(2026, 10), 1.05}}, 0.008, q)
	s.bal = keys(r, []key{{0, 27800}, {ym(2020, 3), 28400}, {ym(2020, 5), 29300}, {ym(2023, 2), 31000}, {ym(2023, 4), 31700}, {ym(2026, 7), 34150}, {ym(2026, 10), 33900}}, 55, ym(2026, 7))
	s.save = keys(r, []key{{0, 11200}, {ym(2020, 5), 11800}, {ym(2022, 6), 12300}, {ym(2023, 12), 11000}, {ym(2026, 7), 11300}, {ym(2026, 8), 11160}, {ym(2026, 9), 10900}, {ym(2026, 10), 10660}}, 40, ym(2026, 7))
	s.curr = keys(r, []key{{0, 7200}, {ym(2020, 5), 7700}, {ym(2022, 6), 8000}, {ym(2023, 12), 7200}, {ym(2026, 10), 7350}}, 35, q)
	s.term = keys(r, []key{{0, 2000}, {ym(2022, 6), 1900}, {ym(2023, 3), 2900}, {ym(2023, 12), 4300}, {ym(2025, 6), 4900}, {ym(2026, 10), 5200}}, 25, q)
	s.dep = make([]float64, q)
	for t := range s.dep {
		s.dep[t] = s.save[t] + s.curr[t] + s.term[t]
	}
	s.mort = keys(r, []key{{0, 18100}, {ym(2022, 6), 20900}, {ym(2023, 6), 21300}, {ym(2026, 10), 23500}}, 30, q)
	s.nnm[0] = flows(r, 24, 10, [][3]float64{{2020, 3, 70}, {2020, 4, 50}, {2023, 3, 150}, {2023, 4, 90}, {2026, 8, 8}, {2026, 9, 2}, {2026, 10, -6}})
	s.nnm[1] = flows(r, 22, 14, [][3]float64{{2020, 3, 80}, {2023, 3, 210}, {2023, 4, 130}, {2023, 5, 60}, {2026, 6, 8}, {2026, 7, 0}, {2026, 8, -12}, {2026, 9, -40}, {2026, 10, -58}})
	s.nnm[2] = flows(r, 9, 9, [][3]float64{{2023, 3, 60}, {2026, 9, 3}, {2026, 10, 2}})
	pipe := keys(r, []key{{0, 620}, {ym(2021, 12), 700}, {ym(2022, 9), 600}, {ym(2023, 6), 520}, {ym(2024, 12), 690}, {ym(2025, 12), 760},
		{ym(2026, 5), 820}, {ym(2026, 6), 900}, {ym(2026, 7), 980}, {ym(2026, 8), 1050}, {ym(2026, 9), 1100}, {ym(2026, 10), 1150}}, 22, ym(2026, 5))
	for i := range s.pipe {
		s.pipe[i] = make([]float64, q)
	}
	for t, v := range pipe {
		if t < ym(2026, 5) {
			v += 35 * math.Sin(2*math.Pi*float64(mOf(t)-2)/12)
		}
		a, o := v*(0.42+0.03*math.Sin(float64(t)/7)), v*0.33
		s.pipe[0][t], s.pipe[1][t], s.pipe[2][t] = a, o, v-a-o
	}
	return s
}

const monthCol = "Monat, angegeben als erster Tag des Monats; Bestände per Monatsende"

func alcoTables() []table {
	s := generateALCO()
	f4 := func(v float64) string { return ftoa(v, 4) }
	liq := table{name: "liquiditaet_monat", desc: "Liquiditätskennzahlen per Monatsende",
		cols: []column{
			{"monat", "DATE", monthCol},
			{"lcr_pct", "DOUBLE", "Liquidity Coverage Ratio in Prozent"},
			{"nsfr_pct", "DOUBLE", "Net Stable Funding Ratio in Prozent"},
			{"hqla_mio_chf", "DOUBLE", "Hochliquide Aktiva (HQLA) in Mio. CHF"},
			{"nettomittelabfluesse_mio_chf", "DOUBLE", "Nettomittelabflüsse der nächsten 30 Tage in Mio. CHF"},
		}}
	cap := table{name: "eigenmittel_monat", desc: "Eigenmittelquoten per Monatsende",
		cols: []column{
			{"monat", "DATE", monthCol},
			{"cet1_pct", "DOUBLE", "Hartes Kernkapital in Prozent der risikogewichteten Positionen"},
			{"leverage_pct", "DOUBLE", "Kernkapital im Verhältnis zum Gesamtengagement in Prozent"},
		}}
	irr := table{name: "zinsrisiko_monat", desc: "Zinsrisiko im Bankenbuch per Monatsende",
		cols: []column{
			{"monat", "DATE", monthCol},
			{"delta_eve_pct", "DOUBLE", "Barwertverlust bei einem Zinsschock in Prozent des Kernkapitals"},
		}}
	inc := table{name: "erfolg_monat", desc: "Zinserfolg pro Monat",
		cols: []column{
			{"monat", "DATE", monthCol},
			{"zinsmarge_pct", "DOUBLE", "Nettozinsmarge in Prozent, annualisiert"},
		}}
	bal := table{name: "bilanz_monat", desc: "Bilanzpositionen per Monatsende in Mio. CHF",
		cols: []column{
			{"monat", "DATE", monthCol},
			{"bilanzsumme_mio_chf", "DOUBLE", "Total Aktiven"},
			{"hypotheken_mio_chf", "DOUBLE", "Hypothekarforderungen"},
			{"kundeneinlagen_mio_chf", "DOUBLE", "Verpflichtungen aus Kundeneinlagen, total"},
			{"sparkonten_mio_chf", "DOUBLE", "Kundeneinlagen auf Sparkonten"},
			{"kontokorrente_mio_chf", "DOUBLE", "Kundeneinlagen auf Kontokorrenten"},
			{"festgeld_mio_chf", "DOUBLE", "Kundeneinlagen als Festgeld"},
		}}
	nnm := table{name: "neugeld_monat", desc: "Netto-Neugeld pro Monat und Kundensegment in Mio. CHF",
		cols: []column{
			{"monat", "DATE", monthCol},
			{"segment", "VARCHAR", "Kundensegment"},
			{"nettoneugeld_mio_chf", "DOUBLE", "Zugeflossene minus abgeflossene Kundenvermögen"},
		}}
	pipe := table{name: "pipeline_monat", desc: "Hypotheken-Pipeline per Monatsende nach Stufe in Mio. CHF",
		cols: []column{
			{"monat", "DATE", monthCol},
			{"stufe", "VARCHAR", "Stufe in der Pipeline: Anfrage, Offerte oder Zusage"},
			{"volumen_mio_chf", "DOUBLE", "Volumen, noch nicht ausbezahlt"},
		}}
	for t := 0; t < alcoMonths; t++ {
		d := monthDate(t)
		liq.rows = append(liq.rows, []string{d, f4(s.lcr[t]), f4(s.nsfr[t]), f4(s.hqla[t]), f4(s.outflow[t])})
		cap.rows = append(cap.rows, []string{d, f4(s.cet1[t]), f4(s.lev[t])})
		irr.rows = append(irr.rows, []string{d, f4(s.eve[t])})
		inc.rows = append(inc.rows, []string{d, f4(s.nim[t])})
		bal.rows = append(bal.rows, []string{d, f4(s.bal[t]), f4(s.mort[t]), f4(s.dep[t]), f4(s.save[t]), f4(s.curr[t]), f4(s.term[t])})
		for i, seg := range segments {
			nnm.rows = append(nnm.rows, []string{d, seg, f4(s.nnm[i][t])})
		}
		for i, st := range stages {
			pipe.rows = append(pipe.rows, []string{d, st, f4(s.pipe[i][t])})
		}
	}
	return append([]table{liq, cap, irr, inc, bal, nnm, pipe}, alcoDaily(s)...)
}

// Business days from September 2026 (story time) to the last weekday before today.
func businessDays() []time.Time {
	var out []time.Time
	for d := cal.month(ym(2026, 9)); !d.After(cal.last); d = d.AddDate(0, 0, 1) {
		if d.Weekday() != time.Saturday && d.Weekday() != time.Sunday {
			out = append(out, d)
		}
	}
	return out
}

// bridge walks from one month-end value to the next: a smooth path plus noise
// that vanishes at both ends, so daily values meet the monthly ones exactly.
func bridge(r *mulberry, from, to float64, n int, noise float64) []float64 {
	if n == 0 {
		return nil
	}
	out := make([]float64, n)
	for i := range out {
		f := float64(i+1) / float64(n)
		out[i] = from + (to-from)*f + (r.next()*2-1)*noise*math.Sin(math.Pi*f)
	}
	out[n-1] = to
	return out
}

func alcoDaily(s alcoSeries) []table {
	r := &mulberry{s: 2611}
	days := businessDays()
	byMonth := map[int][]int{}
	for i, d := range days {
		byMonth[cal.index(d)] = append(byMonth[cal.index(d)], i)
	}
	aug, sep, oct, nov := ym(2026, 8), ym(2026, 9), ym(2026, 10), ym(2026, 11)
	// November is still running: LCR keeps easing, deposits drift lower.
	type anchors struct{ start, sep, oct, nov float64 }
	lcrA := anchors{s.lcr[aug], s.lcr[sep], s.lcr[oct], 116.8}
	outA := anchors{s.outflow[aug], s.outflow[sep], s.outflow[oct], 3236}
	depA := anchors{s.dep[aug], s.dep[sep], s.dep[oct], s.dep[oct] * 0.9962}
	path := func(a anchors, noise float64) []float64 {
		var out []float64
		out = append(out, bridge(r, a.start, a.sep, len(byMonth[sep]), noise)...)
		out = append(out, bridge(r, a.sep, a.oct, len(byMonth[oct]), noise)...)
		return append(out, bridge(r, a.oct, a.nov, len(byMonth[nov]), noise)...)
	}
	lcr, outflow, dep := path(lcrA, 1.1), path(outA, 14), path(depA, 38)

	// Net new money: the month totals spread over the business days.
	novTotals := [3]float64{6.4, -17.2, 1.8}
	nnm := make([][3]float64, len(days))
	for _, mon := range []int{sep, oct, nov} {
		idx := byMonth[mon]
		for seg := 0; seg < 3; seg++ {
			total := novTotals[seg]
			switch mon {
			case sep:
				total = s.nnm[seg][sep]
			case oct:
				total = s.nnm[seg][oct]
			}
			w := make([]float64, len(idx))
			sw := 0.0
			for i := range w {
				w[i] = 0.4 + r.next()
				sw += w[i]
			}
			// Daily noise that cancels over the month keeps single days lively.
			jitter := make([]float64, len(idx))
			for i := range jitter {
				jitter[i] = (r.next()*2 - 1) * []float64{2.2, 3.6, 1.4}[seg]
			}
			for i := 0; i+1 < len(jitter); i += 2 {
				jitter[i+1] = -jitter[i]
			}
			if len(jitter)%2 == 1 {
				jitter[len(jitter)-1] = 0
			}
			for i, d := range idx {
				nnm[d][seg] = total*w[i]/sw + jitter[i]
			}
		}
	}

	dayCol := "Geschäftstag"
	liq := table{name: "liquiditaet_tag", desc: "Liquidität pro Geschäftstag",
		cols: []column{
			{"datum", "DATE", dayCol},
			{"lcr_pct", "DOUBLE", "Liquidity Coverage Ratio in Prozent, Tageswert"},
			{"hqla_mio_chf", "DOUBLE", "Hochliquide Aktiva in Mio. CHF"},
			{"nettomittelabfluesse_mio_chf", "DOUBLE", "Nettomittelabflüsse der nächsten 30 Tage in Mio. CHF"},
		}}
	depT := table{name: "einlagen_tag", desc: "Kundeneinlagen pro Geschäftstag in Mio. CHF",
		cols: []column{
			{"datum", "DATE", dayCol},
			{"kundeneinlagen_mio_chf", "DOUBLE", "Verpflichtungen aus Kundeneinlagen, Tagesendbestand"},
		}}
	nnmT := table{name: "neugeld_tag", desc: "Netto-Neugeld pro Geschäftstag und Kundensegment in Mio. CHF",
		cols: []column{
			{"datum", "DATE", dayCol},
			{"segment", "VARCHAR", "Kundensegment"},
			{"nettoneugeld_mio_chf", "DOUBLE", "Zugeflossene minus abgeflossene Kundenvermögen an diesem Tag"},
		}}
	for i, d := range days {
		ds := d.Format("2006-01-02")
		liq.rows = append(liq.rows, []string{ds, ftoa(lcr[i], 4), ftoa(lcr[i]*outflow[i]/100, 4), ftoa(outflow[i], 4)})
		depT.rows = append(depT.rows, []string{ds, ftoa(dep[i], 4)})
		for seg, name := range segments {
			nnmT.rows = append(nnmT.rows, []string{ds, name, ftoa(nnm[i][seg], 4)})
		}
	}
	return []table{liq, depT, nnmT}
}
