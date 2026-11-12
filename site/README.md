# Website

Die Seite auf [lumantic.dev](https://lumantic.dev). Dieser Ordner wird veröffentlicht, wie er ist: kein Build, keine
Bibliotheken. Jede Änderung hier geht mit dem Push auf `main` live (`.github/workflows/pages.yml`).

| Datei | Was |
|---|---|
| `index.html` | Inhalt und Texte (englisch) |
| `styles.css` | Gestaltung. Die Designs sind dieselben Tokens wie in der App (`web/src/styles/themes.css`) |
| `app.js` | Was sich bewegt: der Auftakt (ein Stern, der aufleuchtet), der Flug vom Überblick in die Seite, dazu die Räume Zeit, Bauen und Design |
| `fonts/` | Die Schriften der App als Latin-Subsets, mit ihrer Lizenz (`fonts/LICENSE.txt`) |

Ansehen: `index.html` im Browser öffnen. In Echtzeit prüfen wie die App, mit einem eigenen Szenario:

```powershell
node scripts/ui-test/cdp.mjs --url file:///C:/…/site/index.html --script szenario.mjs --out shots
```

Die Zahlen sind erfunden und folgen dem Beispiel «Industrie»; die Regeln sind eine Kurzfassung der App (eine Kennzahl
wird nur an ihrem Ziel gemessen). Drei Dinge stehen hier ein zweites Mal und müssen von Hand nachgezogen werden:

- **Version:** steht zweimal in `index.html` (im Hero und unter «Data») und kommt aus `internal/config/config.go`.
- **Logo:** die beiden `<symbol>` in `index.html` kommen aus `web/src/logo.ts`.
- **Designs:** die Token-Blöcke am Anfang von `styles.css` kommen aus `web/src/styles/themes.css`, das Firmen-Design
  «Musterbank» aus `config/lumantic.example.json`.
