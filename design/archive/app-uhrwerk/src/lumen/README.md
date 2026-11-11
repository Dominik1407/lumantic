# Lumen

Die Designsprachen von Lumantic. Jede ist ein Block Tokens in [designs.css](designs.css);
die Komponenten in `app.css` lesen nur Tokens.

| Design | Charakter |
|---|---|
| Atlas (Standard) | Nacht, Messing, Sternenlicht. Serifenstimme Cormorant Garamond |
| Zifferblatt | Porzellan und Kobalt, hell. Manrope und Newsreader |
| Messtisch | Blaupause mit Raster, Plotterlinien. IBM Plex Sans Condensed |

## Ein Corporate Design anlegen

Ein neuer Block mit den Werten der Firma genügt:

```css
:root[data-design="musterbank"] {
  --bg: #f4f5f7; --bg-2: #ffffff; --surface: #ffffff; --surface-2: #f2f4f7; --chrome: rgba(255, 255, 255, .9);
  --ink: #1b2430; --ink-2: #4a5566; --dim: #8a94a3;
  --line: rgba(27, 36, 48, .1); --line-2: rgba(27, 36, 48, .2);
  --accent: #1f4fa3; --c1: #1f4fa3; --c2: #8aa4d6; --c3: #c9a24a;
  --f-display: "IBM Plex Sans", sans-serif; --f-voice: "IBM Plex Serif", serif;
  --f-ui: "IBM Plex Sans", sans-serif; --f-data: "IBM Plex Mono", monospace;
  --radius: 4px; --halo: 0; --mark: 0;
  color-scheme: light;
}
```

Dann in `shell.ts` in `DESIGNS` eintragen. Die Statusfarben `--alert`, `--watch` und
`--good` behalten in jedem Design ihre Bedeutung und sollten nur im Ton angepasst werden.

| Token | Wirkung |
|---|---|
| `--halo` | Leuchten um Signale, 0 bis 1 |
| `--mark` | Passermarken an den Ecken der Flächen, 0 oder 1 |
| `--dash` | Strichmuster für Ziellinien und Ringe |
| `--voice-style`, `--voice-size` | die Stimme von Lumina (Sätze, Begründungen) |
| `--page` | Hintergrundmuster der Seite |
| `--past` | Tönung, solange man in der Vergangenheit ist |

Die frühere Version mit sieben abgeleiteten Markenwerten liegt in
`design/archive/board-v1/lumen/`.
