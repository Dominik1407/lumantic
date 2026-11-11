package config

import (
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

// BuiltinDesigns are the designs the app ships with; a corporate design builds on one.
var BuiltinDesigns = []string{"nacht", "kreide", "nebel", "stein", "daemmerung"}

// ColorKeys are the theme tokens a corporate design may set (CSS names without
// "--", in camelCase: sheetLine is --sheet-line).
var ColorKeys = []string{"bg", "bg2", "sheet", "sheetLine", "ink", "ink2", "dim", "calm", "line", "line2", "grid",
	"accent", "accentInk", "accentSoft", "alert", "watch", "good", "c1", "c2", "c3", "chip", "menu"}

var (
	colorRe    = regexp.MustCompile(`^#[0-9a-fA-F]{3,8}$|^rgba?\([0-9., %]+\)$|^transparent$`)
	fontNameRe = regexp.MustCompile(`^[A-Za-z0-9 \-]{1,40}$`)
	designIDRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	assetRe    = regexp.MustCompile(`^[A-Za-z0-9._\-/]{1,120}$`)
	weightRe   = regexp.MustCompile(`^([1-9]00|normal|bold)$`)
)

var fontExt = map[string]bool{".woff2": true, ".woff": true, ".ttf": true, ".otf": true}
var imageExt = map[string]bool{".svg": true, ".png": true, ".jpg": true}

// AssetExt lists the file types served from config/brand/.
var AssetExt = map[string]string{".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
	".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg"}

func builtin(id string) bool {
	for _, b := range BuiltinDesigns {
		if b == id {
			return true
		}
	}
	return false
}

// SafeAsset reports whether p names a file inside config/brand/ with an allowed type.
func SafeAsset(p string, allowed map[string]bool) bool {
	if !assetRe.MatchString(p) || strings.HasPrefix(p, "/") || strings.Contains(p, "\\") {
		return false
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
	}
	return allowed[strings.ToLower(path.Ext(p))]
}

// SanitizeBrand keeps what is valid and names everything it dropped.
func SanitizeBrand(b Brand) (Brand, []string) {
	var problems []string
	out := Brand{Name: strings.TrimSpace(b.Name), Logo: strings.TrimSpace(b.Logo), LogoDark: strings.TrimSpace(b.LogoDark), Designs: []Design{}}
	if len([]rune(out.Name)) > 60 {
		problems = append(problems, "Der Firmenname ist zu lang (höchstens 60 Zeichen).")
		out.Name = string([]rune(out.Name)[:60])
	}
	if out.Logo != "" && !SafeAsset(out.Logo, imageExt) {
		problems = append(problems, fmt.Sprintf("Das Logo %q muss eine .svg-, .png- oder .jpg-Datei in config/brand/ sein.", out.Logo))
		out.Logo = ""
	}
	if out.LogoDark != "" && !SafeAsset(out.LogoDark, imageExt) {
		problems = append(problems, fmt.Sprintf("Das Logo %q muss eine .svg-, .png- oder .jpg-Datei in config/brand/ sein.", out.LogoDark))
		out.LogoDark = ""
	}
	keys := map[string]bool{}
	for _, k := range ColorKeys {
		keys[k] = true
	}
	seen := map[string]bool{}
	for _, d := range b.Designs {
		d.ID, d.Name, d.Base = strings.TrimSpace(d.ID), strings.TrimSpace(d.Name), strings.TrimSpace(d.Base)
		switch {
		case !designIDRe.MatchString(d.ID):
			problems = append(problems, fmt.Sprintf("Design %q: die ID darf nur Kleinbuchstaben, Ziffern und - enthalten.", d.ID))
			continue
		case builtin(d.ID):
			problems = append(problems, fmt.Sprintf("Design %q: diese ID gehört zu einem eingebauten Design.", d.ID))
			continue
		case seen[d.ID]:
			problems = append(problems, fmt.Sprintf("Design %q gibt es zweimal.", d.ID))
			continue
		}
		seen[d.ID] = true
		clean := Design{ID: d.ID, Name: d.Name, Base: d.Base, Colors: map[string]string{}, Fonts: map[string]string{}, FontFiles: []FontFile{}}
		if clean.Name == "" {
			clean.Name = d.ID
		}
		if len([]rune(clean.Name)) > 40 {
			clean.Name = string([]rune(clean.Name)[:40])
		}
		if clean.Base == "" {
			clean.Base = "kreide"
		}
		if !builtin(clean.Base) {
			problems = append(problems, fmt.Sprintf("Design %q: base muss eines von %s sein.", d.ID, strings.Join(BuiltinDesigns, ", ")))
			clean.Base = "kreide"
		}
		names := make([]string, 0, len(d.Colors))
		for k := range d.Colors {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, k := range names {
			v := strings.TrimSpace(d.Colors[k])
			switch {
			case !keys[k]:
				// unknown keys are dropped silently
			case !colorRe.MatchString(v):
				problems = append(problems, fmt.Sprintf("Design %q: %s=%q ist keine Farbe.", d.ID, k, v))
			default:
				clean.Colors[k] = v
			}
		}
		for _, k := range []string{"text", "ui", "mono"} {
			if v, ok := d.Fonts[k]; ok {
				v = strings.TrimSpace(v)
				if fontNameRe.MatchString(v) {
					clean.Fonts[k] = v
				} else if v != "" {
					problems = append(problems, fmt.Sprintf("Design %q: Schriftname %q ist ungültig.", d.ID, v))
				}
			}
		}
		for _, f := range d.FontFiles {
			f.Family, f.File, f.Weight, f.Style = strings.TrimSpace(f.Family), strings.TrimSpace(f.File), strings.TrimSpace(f.Weight), strings.TrimSpace(f.Style)
			if f.Weight == "" {
				f.Weight = "400"
			}
			if f.Style == "" {
				f.Style = "normal"
			}
			switch {
			case !fontNameRe.MatchString(f.Family):
				problems = append(problems, fmt.Sprintf("Design %q: Schriftfamilie %q ist ungültig.", d.ID, f.Family))
			case !SafeAsset(f.File, fontExt):
				problems = append(problems, fmt.Sprintf("Design %q: Schriftdatei %q muss .woff2, .woff, .ttf oder .otf in config/brand/ sein.", d.ID, f.File))
			case !weightRe.MatchString(f.Weight) || (f.Style != "normal" && f.Style != "italic"):
				problems = append(problems, fmt.Sprintf("Design %q: Schriftdatei %q hat ein ungültiges Gewicht oder einen ungültigen Stil.", d.ID, f.File))
			default:
				clean.FontFiles = append(clean.FontFiles, f)
			}
		}
		out.Designs = append(out.Designs, clean)
	}
	return out, problems
}
