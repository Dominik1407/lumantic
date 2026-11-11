package engine

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

var (
	months   = []string{"Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"}
	weekdays = []string{"So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"}
	numbers  = []string{"Keine", "Eine", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht"}
)

// thousands formats a whole number Swiss style: 112’000.
func thousands(v float64) string {
	s := strconv.FormatFloat(math.Abs(math.Round(v)), 'f', 0, 64)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteRune('’')
		}
		b.WriteRune(r)
	}
	if v < 0 && math.Round(v) != 0 {
		return "−" + b.String()
	}
	return b.String()
}

func decimal(v float64, prec int) string {
	s := strconv.FormatFloat(v, 'f', prec, 64)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

// FormatValue returns the display number and its unit.
func FormatValue(v float64, unit string) (string, string) {
	switch unit {
	case "CHF", "EUR":
		if math.Abs(v) >= 1e6 {
			return decimal(v/1e6, 1), "Mio. " + unit
		}
		return thousands(v), unit
	case "von 10", "Min.":
		return strconv.FormatFloat(v, 'f', 1, 64), unit
	case "%":
		return decimal(v, 1), unit
	}
	if v == math.Trunc(v) || math.Abs(v) >= 100 {
		return thousands(v), ""
	}
	return decimal(v, 1), ""
}

func FormatPlain(v float64, unit string) string {
	n, u := FormatValue(v, unit)
	if u == "" {
		return n
	}
	return n + " " + u
}

// formatDelta formats an absolute difference; scores read as points.
func formatDelta(v float64, unit string) string {
	if unit == "von 10" {
		return decimal(math.Abs(v), 1) + " Punkte"
	}
	return FormatPlain(math.Abs(v), unit)
}

func pct(d float64) string {
	p := math.Abs(d * 100)
	if p < 10 {
		return decimal(p, 1) + " %"
	}
	return strconv.FormatFloat(math.Round(p), 'f', 0, 64) + " %"
}

// scaleUnit marks units where a percentage change says little (a score, minutes).
func scaleUnit(unit string) bool { return unit == "von 10" || unit == "Min." || unit == "%" }

func arrow(d float64) string {
	if d > 0 {
		return "↑ "
	}
	return "↓ "
}

func signed(d float64) string {
	if d > 0 {
		return "+"
	}
	return "−"
}

// vsName turns a comparison column into a word: budget_chf -> Budget.
func vsName(col string) string {
	base, _, _ := strings.Cut(strings.ToLower(col), "_")
	return capitalize(base)
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	return strings.ToUpper(string(r[0])) + string(r[1:])
}

// standText is when the data of a week is complete: the following Monday, 06:00.
func standText(asOf time.Time) string {
	s := asOf.AddDate(0, 0, 7)
	return fmt.Sprintf("%s, %d. %s %d, 06:00", weekdays[s.Weekday()], s.Day(), months[s.Month()-1], s.Year())
}

func numberWord(n int) string {
	if n < len(numbers) {
		return numbers[n]
	}
	return strconv.Itoa(n)
}

func joinGerman(items []string) string {
	switch len(items) {
	case 0:
		return ""
	case 1:
		return items[0]
	}
	return strings.Join(items[:len(items)-1], ", ") + " und " + items[len(items)-1]
}
