package beispiele

import (
	"encoding/csv"
	"os"
	"strconv"
	"sync"
	"time"
)

// The examples tell a story in months t = 0 … 93, from January 2019 to
// October 2026 in the story's own time (ym), with daily values into November.
// The clock moves the whole story so that it always ends now: its last month is
// the month before today, its days run to the last weekday before today, and
// its budgets belong to the years they fall in. Seasons follow the real
// calendar, so December stays December wherever the story lands.
type clock struct {
	start time.Time // the real first day of story month 0
	last  time.Time // the last day with daily values
	shift int       // months the story moved
	years int       // years the budgets moved
}

// The story's own today: Wednesday, 11 November 2026. With it the examples
// come out as they were first written.
var storyToday = time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC)

func clockFor(today time.Time) clock {
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	anchor := time.Date(today.Year(), today.Month()-1, 1, 0, 0, 0, 0, time.UTC)
	shift := anchor.Year()*12 + int(anchor.Month()) - (2026*12 + 10)
	last := today.AddDate(0, 0, -1)
	for last.Weekday() == time.Saturday || last.Weekday() == time.Sunday {
		last = last.AddDate(0, 0, -1)
	}
	return clock{start: time.Date(2019, time.Month(1+shift), 1, 0, 0, 0, 0, time.UTC), last: last, shift: shift, years: anchor.Year() - 2026}
}

// cal is the clock the generators read; Tables and Write set it, one at a time.
var (
	cal   = clockFor(storyToday)
	calMu sync.Mutex
)

// at runs f with the story placed at today.
func at(today time.Time, f func()) {
	calMu.Lock()
	defer calMu.Unlock()
	cal = clockFor(today)
	f()
}

// month is the real first day of story month t.
func (c clock) month(t int) time.Time { return c.start.AddDate(0, t, 0) }

// index is the story month of a real day.
func (c clock) index(d time.Time) int {
	return (d.Year()-c.start.Year())*12 + int(d.Month()) - int(c.start.Month())
}

// year is a year of the story in real time.
func (c clock) year(y int) string { return strconv.Itoa(y + c.years) }

// ym is the story month of a month in the story's own time.
func ym(y, m int) int { return (y-2019)*12 + (m - 1) }

// mOf is the calendar month of story month t, 0 for January.
func mOf(t int) int { return int(cal.month(t).Month()) - 1 }

func monthDate(t int) string { return cal.month(t).Format("2006-01-02") }

type column struct{ name, typ, desc string }

type table struct {
	name, desc string
	cols       []column
	rows       [][]string
}

func itoa(v int) string               { return strconv.Itoa(v) }
func ftoa(v float64, prec int) string { return strconv.FormatFloat(v, 'f', prec, 64) }

func writeCSV(path string, t table) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := csv.NewWriter(f)
	head := make([]string, len(t.cols))
	for i, c := range t.cols {
		head[i] = c.name
	}
	w.Write(head)
	w.WriteAll(t.rows)
	return w.Error()
}
