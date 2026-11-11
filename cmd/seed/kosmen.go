package main

import "math"

// Two more demo gold layers, «Firmenkunden» and «Privatkunden», monthly from
// January 2019 to October 2026. Each is a plain folder of CSV files, the way a
// team without a database would hand over its gold layer; Lumantic reads them
// as the data source «Ordner mit Parquet- oder CSV-Dateien». They are what a
// second and third Kosmos show (definitions in config/beispiele/). All figures
// are invented.

type folderLayer struct {
	folder string
	tables []table
}

func folderLayers() []folderLayer {
	return []folderLayer{{"firmenkunden", firmenkundenTables()}, {"privatkunden", privatkundenTables()}, {"industrie", industrieTables()}}
}

// drift splits a total into parts whose weights move slowly, so the parts
// shift a little against each other.
func drift(total []float64, weights []float64, period float64) [][]float64 {
	out := make([][]float64, len(weights))
	for i := range out {
		out[i] = make([]float64, len(total))
	}
	for t, v := range total {
		sum, ws := 0.0, make([]float64, len(weights))
		for i, w := range weights {
			ws[i] = w * (1 + 0.06*math.Sin(float64(t)/period+float64(i)*2.1))
			sum += ws[i]
		}
		for i := range weights {
			out[i][t] = v * ws[i] / sum
		}
	}
	return out
}

func firmenkundenTables() []table {
	r := &mulberry{s: 2207}
	q := alcoMonths
	f4 := func(v float64) string { return ftoa(v, 4) }
	segs := []string{"KMU", "Grossfirmen", "Immobilien"}

	vol := keys(r, []key{{0, 7400}, {ym(2020, 4), 7900}, {ym(2022, 6), 8600}, {ym(2024, 6), 9100}, {ym(2026, 10), 9650}}, 28, q)
	// New business held its level for years and has been slipping since the summer of 2026.
	neu := flows(r, 196, 22, [][3]float64{{2020, 4, 310}, {2020, 5, 280}, {2026, 6, 184}, {2026, 7, 176}, {2026, 8, 168}, {2026, 9, 159}, {2026, 10, 151}})
	einl := keys(r, []key{{0, 5200}, {ym(2020, 6), 6100}, {ym(2023, 3), 6500}, {ym(2024, 6), 6200}, {ym(2026, 10), 6480}}, 45, q)
	marge := keys(r, []key{{0, 1.52}, {ym(2021, 12), 1.47}, {ym(2023, 6), 1.71}, {ym(2025, 6), 1.64}, {ym(2026, 10), 1.58}}, 0.012, ym(2026, 8))
	// The default rate crossed its early warning line in spring 2026 and keeps rising.
	npl := keys(r, []key{{0, 0.92}, {ym(2020, 9), 1.28}, {ym(2021, 12), 0.95}, {ym(2024, 12), 0.88}, {ym(2026, 3), 1.02}, {ym(2026, 4), 1.07}, {ym(2026, 5), 1.12},
		{ym(2026, 6), 1.17}, {ym(2026, 7), 1.21}, {ym(2026, 8), 1.25}, {ym(2026, 9), 1.3}, {ym(2026, 10), 1.34}}, 0.02, ym(2026, 3))
	limit := keys(r, []key{{0, 62}, {ym(2020, 4), 74}, {ym(2021, 6), 63}, {ym(2024, 6), 66}, {ym(2026, 10), 68}}, 0.9, q)
	wb := keys(r, []key{{0, 58}, {ym(2020, 12), 81}, {ym(2022, 6), 60}, {ym(2025, 6), 57}, {ym(2026, 10), 71}}, 1.2, q)

	volBy, neuBy := drift(vol, []float64{0.46, 0.31, 0.23}, 9), drift(neu, []float64{0.52, 0.27, 0.21}, 5)
	// The slip in new business is the SMEs': the other two segments hold.
	for t := ym(2026, 6); t < q; t++ {
		rest := neuBy[1][t] + neuBy[2][t]
		hold := 0.48 * 196
		neuBy[1][t], neuBy[2][t] = hold*neuBy[1][t]/rest, hold*neuBy[2][t]/rest
		neuBy[0][t] = neu[t] - hold
	}

	kredite := table{name: "kredite_monat", desc: "Kredite an Firmenkunden pro Monat und Segment in Mio. CHF",
		cols: []column{{"monat", "DATE", monthCol}, {"segment", "VARCHAR", "Kundensegment"},
			{"kreditvolumen_mio_chf", "DOUBLE", "Ausstehende Kredite per Monatsende"}, {"neugeschaeft_mio_chf", "DOUBLE", "Neu ausbezahlte Kredite im Monat"}}}
	qual := table{name: "qualitaet_monat", desc: "Ertrag und Risiko des Firmenkundengeschäfts per Monatsende",
		cols: []column{{"monat", "DATE", monthCol}, {"kreditmarge_pct", "DOUBLE", "Marge über dem Refinanzierungssatz in Prozent"},
			{"ausfallquote_pct", "DOUBLE", "Anteil notleidender Kredite am Volumen in Prozent"},
			{"limitenauslastung_pct", "DOUBLE", "Beanspruchte Kreditlimiten in Prozent der zugesagten"},
			{"wertberichtigungen_mio_chf", "DOUBLE", "Bestand an Wertberichtigungen in Mio. CHF"}}}
	einlagen := table{name: "einlagen_monat", desc: "Einlagen der Firmenkunden per Monatsende in Mio. CHF",
		cols: []column{{"monat", "DATE", monthCol}, {"firmeneinlagen_mio_chf", "DOUBLE", "Verpflichtungen gegenüber Firmenkunden"}}}
	for t := 0; t < q; t++ {
		d := monthDate(t)
		for i, s := range segs {
			kredite.rows = append(kredite.rows, []string{d, s, f4(volBy[i][t]), f4(neuBy[i][t])})
		}
		qual.rows = append(qual.rows, []string{d, f4(marge[t]), f4(npl[t]), f4(limit[t]), f4(wb[t])})
		einlagen.rows = append(einlagen.rows, []string{d, f4(einl[t])})
	}
	return []table{kredite, qual, einlagen}
}

func privatkundenTables() []table {
	r := &mulberry{s: 4071}
	q := alcoMonths
	f4 := func(v float64) string { return ftoa(v, 4) }
	terms := []string{"Fest bis 5 Jahre", "Fest über 5 Jahre", "SARON"}

	hypo := keys(r, []key{{0, 16400}, {ym(2021, 6), 18200}, {ym(2023, 6), 19600}, {ym(2026, 10), 21400}}, 26, q)
	neu := make([]float64, q)
	for t := range neu {
		// Mortgages are a spring business: a mild season is part of the figure.
		neu[t] = 176 + 11*math.Sin(2*math.Pi*float64(mOf(t)-1)/12) + (r.next()*2-1)*13 + 0.22*float64(t)
	}
	// 2026 so far, written out: a steady year, so this Kosmos is the quiet one of the three.
	for i, v := range []float64{188, 193, 201, 206, 204, 199, 197, 192, 190, 194} {
		neu[ym(2026, 1)+i] = v
	}
	vorsorge := keys(r, []key{{0, 2900}, {ym(2022, 12), 3500}, {ym(2026, 10), 4350}}, 9, q)
	karten := make([]float64, q)
	for t := range karten {
		peak := 0.0
		if mOf(t) == 11 {
			peak = 58
		}
		karten[t] = 232 + 1.3*float64(t) + 16*math.Sin(2*math.Pi*float64(mOf(t)-5)/12) + peak + (r.next()*2-1)*7
	}
	karten[ym(2020, 4)], karten[ym(2020, 5)] = 168, 181 // shops closed
	// The new app went live in October 2026: the share of digital orders jumps.
	digital := keys(r, []key{{0, 41}, {ym(2020, 6), 52}, {ym(2023, 12), 63}, {ym(2026, 9), 68.5}, {ym(2026, 10), 74.2}}, 0.5, ym(2026, 9))
	churn := keys(r, []key{{0, 0.52}, {ym(2021, 6), 0.44}, {ym(2023, 6), 0.58}, {ym(2024, 12), 0.5}, {ym(2026, 10), 0.47}}, 0.012, q)
	cir := keys(r, []key{{0, 63.5}, {ym(2021, 12), 62.4}, {ym(2023, 9), 58.1}, {ym(2025, 6), 59.8}, {ym(2026, 10), 59.4}}, 0.35, q)

	hypoBy, neuBy := drift(hypo, []float64{0.34, 0.41, 0.25}, 11), drift(neu, []float64{0.3, 0.38, 0.32}, 6)
	hyp := table{name: "hypotheken_monat", desc: "Hypotheken an Privatkunden pro Monat und Laufzeit in Mio. CHF",
		cols: []column{{"monat", "DATE", monthCol}, {"laufzeit", "VARCHAR", "Art und Laufzeit der Hypothek"},
			{"bestand_mio_chf", "DOUBLE", "Hypothekarbestand per Monatsende"}, {"neugeschaeft_mio_chf", "DOUBLE", "Neu ausbezahlte Hypotheken im Monat"}}}
	kunden := table{name: "kunden_monat", desc: "Kundenbeziehung und Effizienz pro Monat",
		cols: []column{{"monat", "DATE", monthCol}, {"digitalquote_pct", "DOUBLE", "Anteil der Aufträge über App und E-Banking in Prozent"},
			{"kuendigungsquote_pct", "DOUBLE", "Aufgelöste Kundenbeziehungen in Prozent des Bestands, pro Monat"},
			{"cost_income_pct", "DOUBLE", "Geschäftsaufwand in Prozent des Geschäftsertrags, rollierend zwölf Monate"}}}
	anlagen := table{name: "anlagen_monat", desc: "Vorsorge und Zahlungsverkehr der Privatkunden in Mio. CHF",
		cols: []column{{"monat", "DATE", monthCol}, {"vorsorge_mio_chf", "DOUBLE", "Vorsorgegelder der Säule 3a per Monatsende"},
			{"kartenumsatz_mio_chf", "DOUBLE", "Umsatz mit Debit- und Kreditkarten im Monat"}}}
	for t := 0; t < q; t++ {
		d := monthDate(t)
		for i, s := range terms {
			hyp.rows = append(hyp.rows, []string{d, s, f4(hypoBy[i][t]), f4(neuBy[i][t])})
		}
		kunden.rows = append(kunden.rows, []string{d, f4(digital[t]), f4(churn[t]), f4(cir[t])})
		anlagen.rows = append(anlagen.rows, []string{d, f4(vorsorge[t]), f4(karten[t])})
	}
	return []table{hyp, kunden, anlagen}
}
