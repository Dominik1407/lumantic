package engine

import "testing"

func TestFormatValue(t *testing.T) {
	cases := []struct {
		v          float64
		unit, n, u string
	}{
		{112000, "CHF", "112’000", "CHF"},
		{14200000, "CHF", "14.2", "Mio. CHF"},
		{12000000, "CHF", "12", "Mio. CHF"},
		{7.6, "von 10", "7.6", "von 10"},
		{148, "", "148", ""},
		{1234567, "", "1’234’567", ""},
		{-2500, "CHF", "−2’500", "CHF"},
	}
	for _, c := range cases {
		if n, u := FormatValue(c.v, c.unit); n != c.n || u != c.u {
			t.Errorf("FormatValue(%v, %q) = %q %q, want %q %q", c.v, c.unit, n, u, c.n, c.u)
		}
	}
}

func TestPct(t *testing.T) {
	for d, want := range map[float64]string{0.12: "12 %", -0.0083: "0.8 %", 0.48: "48 %", 0.05: "5 %"} {
		if got := pct(d); got != want {
			t.Errorf("pct(%v) = %q, want %q", d, got, want)
		}
	}
}

func TestDriverNeedsAStandout(t *testing.T) {
	p := func(v float64) *float64 { return &v }
	even := []Group{{Name: "Zürich", V: 7.6, Prev: p(7.9)}, {Name: "Bern", V: 7.7, Prev: p(8.0)}}
	if got := driver(cardSpec(">="), even, "von 10", 1, "filiale"); got != "" {
		t.Errorf("all branches moved alike, want no driver, got %q", got)
	}
	uneven := []Group{{Name: "Zürich", V: 40, Prev: p(31)}, {Name: "Bern", V: 14, Prev: p(13)}}
	if got := driver(cardSpec("<="), uneven, "", -1, "filiale"); got != "Grund: Filiale Zürich, +9 gegenüber Vorwoche" {
		t.Errorf("got %q", got)
	}
}
