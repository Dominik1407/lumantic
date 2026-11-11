package config

import (
	"fmt"
	"strings"
)

// Grains are the rasters a Kosmos can judge its figures in. Its standard
// raster decides the status of «Heute» and the main menu; people may read the
// pages in another one. Weeks and days follow with daily data.
var Grains = []string{"monat", "quartal", "jahr"}

// GrainOf returns the standard raster of a Kosmos: the one written down, or
// "monat".
func GrainOf(g string) string {
	if g == "" {
		return "monat"
	}
	return g
}

func normalizeGrain(g *string) { *g = strings.ToLower(strings.TrimSpace(*g)) }

// ValidateGrain checks a standard raster. Empty means the usual one.
func ValidateGrain(g string) error {
	if g == "" {
		return nil
	}
	for _, x := range Grains {
		if g == x {
			return nil
		}
	}
	return fmt.Errorf("Unbekanntes Raster %q. Möglich sind monat, quartal und jahr.", g)
}
