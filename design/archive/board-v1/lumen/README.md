# Lumen

Das Designsystem von Lumantic. Schlank, weil ein Corporate Design nur sieben Werte setzt
und alles andere daraus abgeleitet wird.

## Die sieben Werte

| Wert | Token | Beispiel |
|---|---|---|
| Markenfarbe | `--lm-brand` | `#c9971c` |
| Schrift Überschriften | `--lm-font-display` | Bricolage Grotesque |
| Schrift Text | `--lm-font-body` | Geist |
| Schrift Code | `--lm-font-mono` | Geist Mono |
| Ecken | `--lm-radius` | `16px` |
| Dichte | `--lm-density` | `1` (0.85 bis 1.2) |
| Markenton in Grautönen | `--lm-tint` | `2%` (0 bis 10) |

Ein Design als JSON, wie es das Design-Panel exportiert:

```json
{
  "name": "Musterbank",
  "brand": "#1f4fa3",
  "display": "IBM Plex Sans",
  "body": "IBM Plex Sans",
  "mono": "IBM Plex Mono",
  "radius": 4,
  "density": 0.95,
  "tint": 3,
  "workspace": "Musterbank"
}
```

## Abgeleitet

`tokens.css` berechnet daraus mit `color-mix(in oklch, …)` alle Flächen
(`--lm-bg`, `--lm-surface`, `--lm-surface-2`), Schrift- und Linienfarben, die Akzentfarbe
in einer lesbaren Variante für Text (`--lm-accent-ink`), weiche Flächen und den Schein
(`--lm-accent-soft`, `--lm-accent-glow`), Abstände (`--lm-s1` bis `--lm-s6`) und Radien.
Der Dark Mode leitet sich aus denselben Werten ab.

## Fix, nicht themebar

Die Statusfarben `--lm-crit`, `--lm-warn` und `--lm-good` bleiben in jedem Design gleich.
Rot heisst überall «braucht dich». Status erscheint nie nur als Farbe, sondern immer mit
Punkt und Wort.

## Regeln

- Komponenten nutzen nur semantische Tokens (`--lm-surface`, `--lm-ink-2` …), nie die Markenfarbe direkt für Text.
- Schatten nur für Karten, die Aufmerksamkeit brauchen. Höhe heisst Dringlichkeit.
- Die Markenfarbe ist Akzent (Schein, Fokus, Hervorhebung), keine Fläche für grosse Buttons. Primäre Buttons sind Tinte.

## Komponenten

`lm-btn` (`--ghost`, `--quiet`), `lm-pill`, `lm-status` (`--alert`, `--watch`, `--good`,
`--info`, `--calm`), `lm-chip`, `lm-input`, `lm-select`, `lm-textarea`, `lm-card`
(`--raised`), `lm-drawer`, `lm-close`, `lm-eyebrow`, `lm-display`, `lm-num`.
