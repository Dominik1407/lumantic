package beispiele

import "math"

// «Industrie»: the gold layer of the Musterwerk AG, an invented Swiss maker of
// drives and controls with plants in Aarau, Brno and Suzhou. It shows a
// Kosmos whose meaning comes from three places: a company catalog kept beside
// the data (lumantic_kennzahlen, lumantic_ziele, lumantic_begriffe), what
// Lumantic adds (config/beispiele/industrie.json), and guesses from column
// names. All figures are invented.
//
// The months tell a story (in story time, see story.go): deliveries on time
// have dropped below their minimum since August 2026, stock reaches further and
// further, the EBIT margin misses the higher budget of 2026, and the plants'
// OEE keeps getting better.

func industrieTables() []Table {
	r := &mulberry{s: 7331}
	q := alcoMonths
	f2 := func(v float64) string { return ftoa(v, 2) }
	f0 := func(v float64) string { return ftoa(math.Round(v), 0) }
	sparten := []string{"Antriebe", "Steuerungen", "Service"}
	werke := []string{"Aarau", "Brno", "Suzhou"}

	// Sales: about 40 Mio. CHF a month, a summer dip and a strong December, slowly growing.
	umsatz := make([]float64, q)
	for t := range umsatz {
		season := map[int]float64{6: -0.05, 7: -0.12, 11: 0.09}[mOf(t)]
		umsatz[t] = (36.5 + 0.06*float64(t)) * (1 + season + (r.next()*2-1)*0.025)
	}
	umsatz[ym(2020, 4)], umsatz[ym(2020, 5)] = 29.4, 31.2 // lockdown
	// Orders ran slightly ahead of sales for years; since July 2026 the controls business orders less.
	eingang := make([]float64, q)
	for t := range eingang {
		eingang[t] = umsatz[t] * (1.03 + (r.next()*2-1)*0.05)
	}
	umsatzBy, eingangBy := drift(umsatz, []float64{0.52, 0.31, 0.17}, 8), drift(eingang, []float64{0.5, 0.33, 0.17}, 6)
	for t := ym(2026, 7); t < q; t++ {
		// The drop in orders is the controls business's: the other two hold.
		eingangBy[1][t] *= 0.82 - 0.05*float64(t-ym(2026, 7))
		eingang[t] = eingangBy[0][t] + eingangBy[1][t] + eingangBy[2][t]
	}

	ebit := keys(r, []key{{0, 7.9}, {ym(2020, 4), 4.1}, {ym(2020, 12), 7.2}, {ym(2023, 6), 8.4}, {ym(2025, 6), 8.6}, {ym(2026, 3), 8.5}, {ym(2026, 10), 8.2}}, 0.35, q)
	material := keys(r, []key{{0, 44.2}, {ym(2022, 6), 47.8}, {ym(2024, 6), 45.6}, {ym(2026, 10), 45.1}}, 0.5, q)
	oee := keys(r, []key{{0, 70.8}, {ym(2020, 4), 61.0}, {ym(2020, 9), 70.1}, {ym(2023, 6), 73.4}, {ym(2025, 6), 75.6}, {ym(2026, 10), 77.6}}, 0.7, q)
	// On-time delivery: steady around 95 %, then a supplier problem in Asia from August 2026.
	otif := keys(r, []key{{0, 94.6}, {ym(2021, 9), 91.8}, {ym(2022, 9), 94.1}, {ym(2026, 6), 95.2}, {ym(2026, 7), 93.8}, {ym(2026, 8), 89.7}, {ym(2026, 9), 89.1}, {ym(2026, 10), 88.6}}, 0.6, ym(2026, 7))
	reich := keys(r, []key{{0, 47}, {ym(2021, 12), 55}, {ym(2023, 6), 49}, {ym(2025, 9), 51}, {ym(2026, 10), 58.6}}, 1.1, ym(2026, 5))
	gesamt := make([]float64, q)
	for t := range gesamt {
		gesamt[t] = umsatz[t] * 4850 * (1 + (r.next()*2-1)*0.02)
	}
	quote := keys(r, []key{{0, 2.6}, {ym(2022, 6), 2.3}, {ym(2026, 10), 2.1}}, 0.12, q)
	lagerwert := keys(r, []key{{0, 61}, {ym(2021, 12), 74}, {ym(2023, 6), 66}, {ym(2026, 10), 79}}, 1.3, q)

	gesamtBy, lagerBy := drift(gesamt, []float64{0.38, 0.41, 0.21}, 7), drift(lagerwert, []float64{0.44, 0.35, 0.21}, 10)

	finanzen := Table{Name: "finanzen_monat", Desc: "Umsatz und Auftragseingang pro Monat und Sparte in Mio. CHF",
		Cols: []Column{{"monat", "DATE", monthCol}, {"sparte", "VARCHAR", "Sparte"},
			{"umsatz_mio", "DOUBLE", "Fakturierter Nettoumsatz"}, {"auftragseingang_mio", "DOUBLE", "Neu eingegangene Bestellungen"}}}
	kpi := Table{Name: "kpi_monat", Desc: "Kennzahlen der ganzen Gruppe pro Monat",
		Cols: []Column{{"monat", "DATE", monthCol}, {"ebit_marge_pct", "DOUBLE", "EBIT in Prozent des Umsatzes"},
			{"materialquote_pct", "DOUBLE", "Materialaufwand in Prozent des Umsatzes"}, {"oee_pct", "DOUBLE", "Gesamtanlageneffektivität aller Werke"},
			{"liefertreue_pct", "DOUBLE", "Pünktlich und vollständig gelieferte Aufträge in Prozent"},
			{"lagerreichweite_tage", "DOUBLE", "Reichweite des Lagers in Arbeitstagen"},
			{"ausschussquote_pct", "DOUBLE", "Ausschuss in Prozent der gefertigten Teile"},
			{"ausschuss_stk", "DOUBLE", "Teile mit Fehler"}, {"gesamt_stk", "DOUBLE", "Gefertigte Teile insgesamt"}}}
	produktion := Table{Name: "produktion_monat", Desc: "Gefertigte Teile pro Monat und Werk",
		Cols: []Column{{"monat", "DATE", monthCol}, {"werk", "VARCHAR", "Werk"}, {"gutteile_stk", "DOUBLE", "Fehlerfreie Teile"}}}
	lager := Table{Name: "lager_monat", Desc: "Lagerwert pro Werk per Monatsende in Mio. CHF",
		Cols: []Column{{"monat", "DATE", monthCol}, {"werk", "VARCHAR", "Werk"}, {"lagerwert_mio", "DOUBLE", "Wert des Lagers per Monatsende"}}}
	var gut [3][]float64
	ausM := make([]float64, q)
	for i := range gut {
		gut[i] = make([]float64, q)
	}
	for t := 0; t < q; t++ {
		d := monthDate(t)
		ausM[t] = gesamt[t] * quote[t] / 100
		for i, s := range sparten {
			finanzen.Rows = append(finanzen.Rows, []string{d, s, f2(umsatzBy[i][t]), f2(eingangBy[i][t])})
		}
		aus := gesamt[t] * quote[t] / 100
		kpi.Rows = append(kpi.Rows, []string{d, f2(ebit[t]), f2(material[t]), f2(oee[t]), f2(otif[t]), f2(reich[t]), f2(quote[t]), f0(aus), f0(gesamt[t])})
		for i, w := range werke {
			gut[i][t] = gesamtBy[i][t] * (1 - quote[t]/100)
			produktion.Rows = append(produktion.Rows, []string{d, w, f0(gut[i][t])})
			lager.Rows = append(lager.Rows, []string{d, w, f2(lagerBy[i][t])})
		}
	}

	// The company catalog, as the controlling team keeps it beside the data.
	katalog := Table{Name: "lumantic_kennzahlen", Desc: "Fachkatalog: was die Kennzahlen bedeuten",
		Cols: []Column{{"id", "VARCHAR", ""}, {"name", "VARCHAR", ""}, {"definition", "VARCHAR", ""}, {"thema", "VARCHAR", ""},
			{"einheit", "VARCHAR", ""}, {"art", "VARCHAR", ""}, {"richtung", "VARCHAR", ""}, {"tabelle", "VARCHAR", ""},
			{"wert_spalte", "VARCHAR", ""}, {"teile_spalte", "VARCHAR", ""}, {"eigner", "VARCHAR", ""}, {"berechnung", "VARCHAR", ""},
			{"name_en", "VARCHAR", ""}, {"definition_en", "VARCHAR", ""}, {"thema_en", "VARCHAR", ""}, {"berechnung_en", "VARCHAR", ""}},
		Rows: [][]string{
			{"umsatz", "Umsatz", "Fakturierter Nettoumsatz ohne MWST, nach Sparte.", "Finanzen", "Mio. CHF", "Fluss", "höher ist besser",
				"gold.finanzen_monat", "umsatz_mio", "sparte", "Finanzen · M. Keller", "Rechnungen im Monat abzüglich Gutschriften",
				"Revenue", "Invoiced net revenue without VAT, by division.", "Finance", "Invoices of the month less credit notes"},
			// The controlling team has not described order intake yet: Lumantic adds the words and guesses the unit.
			{"auftragseingang", "Auftragseingang", "", "Vertrieb", "", "", "", "gold.finanzen_monat", "auftragseingang_mio", "sparte", "", "",
				"Order intake", "", "Sales", ""},
			{"ebit_marge", "EBIT-Marge", "Betriebsergebnis vor Zinsen und Steuern in Prozent des Umsatzes.", "Finanzen", "%", "Bestand", "höher ist besser",
				"gold.kpi_monat", "ebit_marge_pct", "", "Finanzen · M. Keller", "EBIT ÷ Umsatz der letzten zwölf Monate",
				"EBIT margin", "Operating result before interest and taxes as a percentage of revenue.", "Finance", "EBIT ÷ revenue of the last twelve months"},
			{"oee", "OEE", "Gesamtanlageneffektivität über alle Werke: Verfügbarkeit × Leistung × Qualität.", "Produktion", "%", "Durchschnitt", "höher ist besser",
				"gold.kpi_monat", "oee_pct", "", "Produktion · Werkleitung", "Gutteile × Soll-Taktzeit ÷ geplante Produktionszeit",
				"OEE", "Overall equipment effectiveness across all plants: availability × performance × quality.", "Production",
				"Good parts × target cycle time ÷ planned production time"},
			{"liefertreue", "Liefertreue", "Anteil der Aufträge, die vollständig und zum zugesagten Termin beim Kunden waren.", "Logistik", "%", "", "höher ist besser",
				"gold.kpi_monat", "liefertreue_pct", "", "Logistik", "",
				"Delivery reliability", "Share of orders that reached the customer complete and on the promised date.", "Logistics", ""},
		}}
	// Sales have an annual budget, as controlling sets it; Lumantic spreads it over the months and days.
	// Budgets hold for calendar years: the year the story ends in, and the one before.
	y25, y26 := cal.year(2025), cal.year(2026)
	ziele := Table{Name: "lumantic_ziele", Desc: "Fachkatalog: Ziele und Grenzen mit Gültigkeit",
		Cols: []Column{{"kennzahl_id", "VARCHAR", ""}, {"art", "VARCHAR", ""}, {"wert", "DOUBLE", ""}, {"name", "VARCHAR", ""},
			{"gueltig_ab", "VARCHAR", ""}, {"gueltig_bis", "VARCHAR", ""}, {"periode", "VARCHAR", ""}, {"name_en", "VARCHAR", ""}},
		Rows: [][]string{
			{"umsatz", "Ziel", "480", "Budget " + y25, y25 + "-01-01", y25 + "-12-31", "Jahr", "Budget " + y25},
			{"umsatz", "Ziel", "500", "Budget " + y26, y26 + "-01-01", y26 + "-12-31", "Jahr", "Budget " + y26},
			{"ebit_marge", "Ziel", "8.0", "Budget " + y25, y25 + "-01-01", y25 + "-12-31", "", "Budget " + y25},
			{"ebit_marge", "Ziel", "9.0", "Budget " + y26, y26 + "-01-01", "", "", "Budget " + y26},
			{"oee", "Ziel", "75", "Ziel " + y25, y25 + "-01-01", y25 + "-12-31", "", "Target " + y25},
			{"oee", "Ziel", "78", "Ziel " + y26, y26 + "-01-01", "", "", "Target " + y26},
			{"liefertreue", "Ziel", "95", "Ziel", "", "", "", "Target"},
			{"liefertreue", "Grenze", "90", "Mindestwert", "", "", "", "Minimum"},
		}}
	begriffe := Table{Name: "lumantic_begriffe", Desc: "Fachkatalog: die Wörter des Hauses",
		Cols: []Column{{"begriff", "VARCHAR", ""}, {"definition", "VARCHAR", ""}, {"synonyme", "VARCHAR", ""}, {"kennzahl_id", "VARCHAR", ""},
			{"begriff_en", "VARCHAR", ""}, {"definition_en", "VARCHAR", ""}},
		Rows: [][]string{
			{"OEE", "Gesamtanlageneffektivität: wie viel von der geplanten Zeit eine Anlage gute Teile im Soll-Takt fertigt.", "Anlageneffektivität; GAE; Overall Equipment Effectiveness", "oee",
				"OEE", "Overall equipment effectiveness: how much of the planned time a machine makes good parts at the target cycle."},
			{"OTIF", "On Time In Full: pünktlich und vollständig geliefert.", "Liefertreue; Termintreue", "liefertreue", "OTIF", "On time in full: delivered on time and complete."},
			{"EBIT", "Ergebnis vor Zinsen und Steuern.", "Betriebsergebnis", "ebit_marge", "EBIT", "Earnings before interest and taxes."},
			{"Book-to-Bill", "Auftragseingang geteilt durch Umsatz. Über 1 wächst der Auftragsbestand, unter 1 schmilzt er.", "Auftragsdeckung", "",
				"Book-to-bill", "Order intake divided by revenue. Above 1 the order backlog grows, below 1 it shrinks."},
		}}
	return append([]Table{finanzen, kpi, produktion, lager, katalog, ziele, begriffe}, industrieDaily(&mulberry{s: 4417}, gut, gesamt, ausM)...)
}
