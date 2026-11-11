# Lumantic

**Quiet until it matters.**

Lumantic ist eine ruhige Oberfläche über dem Goldlayer eines Teams. Seiten aus Bausteinen
liegen in einem Raum: Aus der Nähe liest man sie wie einen Brief, aus der Ferne falten sie
sich zu Sternbildern. Lumina, die Assistentin, schreibt «Heute» und eine Seite pro Thema und
begründet jede Wahl. Alles andere baut man selbst, und es bleibt gespeichert.

Der Name: **Lum**en (Licht) + Se**mantic** (Bedeutung). Bedeutung ans Licht bringen.

```
Bronze    →  Rohdaten
Silver    →  bereinigt
Gold      →  fertige Kennzahlen pro Team
Lumantic  →  die Bedeutung, für alle verständlich
```

## Schnellstart (Windows)

Voraussetzungen: Go 1.25+, Node 20+, DuckDB CLI (`winget install DuckDB.cli`).

```powershell
.\scripts\run.ps1          # baut alles und startet auf http://127.0.0.1:8080
.\scripts\run.ps1 -Seed    # Beispiel-Goldlayer neu erzeugen
```

Danach im Browser `http://127.0.0.1:8080` öffnen. Datenquelle, Kennzahlen, KI und Design
stellt man in der App unter **Einstellungen** ein (Zahnrad am Ende der Leiste unten, oder
Taste `,`). Wer lieber eine Datei pflegt: [config/README.md](config/README.md).

Zum Entwickeln der Oberfläche mit Live-Reload:

```powershell
go run ./cmd/lumantic        # API auf :8080
cd web; npm run dev          # Oberfläche auf :5173, leitet /api und /brand an :8080 weiter
```

## Die App

**Eine Seite ist ein Sternbild aus der Nähe, ein Sternbild ist eine Seite aus der Ferne,
und jeder Stern ist ein Block.**

- **Heute** in der Mitte: was dich diesen Monat braucht, in Sätzen, mit Beleg zum Aufklappen.
- **Eine Seite pro Thema** (Liquidität, Kapital, …), aus den Kennzahlen-Definitionen gebaut.
- **Bauen:** Den Stern eines Blocks greifen und auf eine andere Seite oder ins Leere ziehen.
  Am Seitenende holt `/` einen Baustein, `[[` eine lebende Kennzahl in eine Notiz.
- **Fragen:** In die Zeile am Seitenende eine Frage mit Fragezeichen tippen. Mit KI
  antwortet Lumina in einem Antwort-Block und legt passende Diagramme dazu. Ohne KI sucht
  sie Kennzahl und Ansicht nach Stichwörtern.
- **Zeit:** Der Raum hat einen Monat. Die Zeitlinse unten rechts zeigt Block für Block einen
  anderen Monat; ein Block kann einen Monat festhalten.

### Mehrere Kosmen: das Hauptmenü

Ein **Kosmos** ist ein Raum über einer Datenquelle, mit eigenen Kennzahlen und eigenen Seiten.
Wer mehr als einen Goldlayer sieht, bekommt für jeden einen Kosmos, und Lumantic öffnet im
**Hauptmenü**: jeder Kosmos als kleiner Himmel, ein Stern pro Kennzahl, darunter der Satz, den
Lumina in diesem Kosmos über «Heute» schreibt («Zwei Dinge brauchen dich.»). Ein Klick oder
die Tasten `1` bis `9` fliegen hinein. Zurück führt das Logo oben links oder die Taste `K`.

Einen weiteren Kosmos legt man im Hauptmenü an («Kosmos hinzufügen»): Name, Datenquelle,
«Verbindung prüfen», «Kosmos anlegen». Seine Kennzahlen bestimmt man danach in seinen
Einstellungen unter «Daten». Mit nur einem Kosmos gibt es kein Hauptmenü, die App öffnet
direkt in ihm. Adressen: `/?k=<id>` ist ein Kosmos, `/?kosmen` das Hauptmenü.

`.\scripts\run.ps1 -Seed` erzeugt neben «ALCO» zwei weitere Beispiel-Goldlayer als Ordner mit
CSV-Dateien, «Firmenkunden» und «Privatkunden». Ihre Kennzahlen liegen in `config/beispiele/`,
[config/lumantic.example.json](config/lumantic.example.json) verbindet alle drei.

Solange es keine Anmeldung gibt, sehen alle Personen alle Kosmen.

### Tasten

| Taste | |
|---|---|
| `H` | Heute |
| `K` | zurück ins Hauptmenü (bei mehreren Kosmen) |
| `1` bis `9` | Themen-Seite öffnen, im Hauptmenü einen Kosmos |
| `0` | Überblick über alle Seiten |
| `←` `→` | Monat zurück oder vor, mit `Shift` ein Jahr |
| `Z` | zwischen jetzt und dem letzten Monat in der Vergangenheit wechseln |
| `Leertaste` | Geschichte abspielen oder anhalten |
| `/` | Baustein einfügen |
| `Tab` | Luminas Vorschlag übernehmen |
| `,` | Einstellungen |
| `?` | die Idee und ihre Quellen |
| `Esc` | schliessen, was offen ist |

### Einstellungen

| Bereich | Was man dort einstellt | Gilt für |
|---|---|---|
| **Darstellung** | Design, Schrift, Akzent, Bewegung, Textgrösse; «Für alle speichern» macht die Wahl zum Standard | dich (oder alle) |
| **Start** | Ansicht beim Öffnen, wohin die Zeitlinse schaut, Hinweise zu Gesten | dich |
| **Daten** | Für den Kosmos, in dem man ist: Datenquelle verbinden und prüfen, neu laden; Kennzahlen hinzufügen, Ziel, Limit und Richtung ändern; den Kosmos entfernen | alle |
| **Kosmen** | Im Hauptmenü an der Stelle von «Daten»: alle Kosmen, einen weiteren anlegen, einen entfernen | alle |
| **Lumina** | KI an oder aus, Modell, API-Token, optional die Adresse eines Firmen-Gateways, Verbindung testen | alle |
| **Über** | Version, Kosmos, Pfad der Konfiguration, eigene Seiten zurücksetzen | |

Persönliches liegt im Arbeitsbereich auf dem Server, alles für alle in `config/lumantic.json`.
Änderungen an Daten oder Kennzahlen baut der Raum beim Schliessen der Einstellungen neu auf.

### Designs

Fünf Designs sind eingebaut: **Nacht** (der ursprüngliche Nachthimmel), **Kreide**, **Nebel**
(Standard), **Stein** und **Dämmerung**. Jede Farbe der Oberfläche, auch in Diagrammen und auf
der Leinwand, ist ein Token des Designs ([web/src/styles/themes.css](web/src/styles/themes.css)).

Ein **Firmen-Design** trägt man in `config/lumantic.json` unter `brand` ein: ein eingebautes
Design als Basis, dazu nur die Farben und Schriften, die abweichen. Logo und Hausschrift kommen
nach `config/brand/`. Die Vorlage «Musterbank» steht in
[config/lumantic.example.json](config/lumantic.example.json), die Felder in
[config/README.md](config/README.md). Das Firmen-Design erscheint danach in der Design-Auswahl.

Die Schriften werden mit der App ausgeliefert. Sie braucht keinen Zugang zu Google Fonts.

### Logo

Das Logo «Baustein» (zwei Blöcke und ein leuchtender Stern) und die Wortmarke stehen an einer
einzigen Stelle im Code, [web/src/logo.ts](web/src/logo.ts). Auch das Symbol im Browser-Tab kommt
von dort.

Ein Unternehmen setzt sein **eigenes Logo** in der Konfiguration: `brand.logo` (und optional
`brand.logoDark` für die dunklen Designs) nennt eine Datei in `config/brand/`. Es steht dann oben
links an der Stelle des Lumantic-Logos, im Hauptmenü wie in jedem Kosmos, und oben rechts
erscheint klein «powered by lumantic». Ein Beispiel liegt bei: `config/brand/musterbank.svg`.

## Lumina, die Regeln dahinter

Jede Kennzahl wird pro Monat, Quartal und Jahr eingestuft:

| Stufe | Wann |
|---|---|
| Regulatorisch verletzt | Grenze unterschritten (bzw. Limit überschritten) |
| Unter internem Ziel | Ziel um mehr als 3 % verfehlt |
| Knapp verfehlt | Ziel verfehlt, aber innerhalb von 3 % |
| Anhaltender Trend | sechs Bewegungen in Folge in die falsche Richtung (Regel der statistischen Prozesskontrolle) |
| Auffällige Bewegung | mehr als 2 Standardabweichungen und mindestens 5 % vom Üblichen der letzten 8 Perioden, in die falsche Richtung |
| Gute Nachricht | ebenso ungewöhnlich, aber in die gute Richtung |
| Erholung, noch knapp | nach einem Alarm wieder im Ziel, aber noch ohne 2 % Sicherheitsabstand (Hysterese) |

Für jede Seite erzeugt Lumina alle sinnvollen Ansichten (Verlauf gegen Grenzen,
Zusammensetzung, Brücke, Zähler und Nenner, kumuliert, Vergleich, Tagesverlauf), bewertet
sie nach Dringlichkeit und Aussagekraft und schlägt die beste als Nächstes vor. Was du
änderst, bleibt so; neue Empfehlungen erscheinen nur als Vorschlag («Dazu passt», `Tab`).

Die Gründe für diese Entscheidungen stehen in [design/README.md](design/README.md).

## Kennzahlen definieren

Was eine Kennzahl ist, wo sie liegt und welche Grenzen gelten, steht in einer JSON-Datei.
Die Zahlen selbst bleiben im Goldlayer. Standard ist
[internal/metrics/default.json](internal/metrics/default.json) mit den ALCO-Kennzahlen.
Wer in den Einstellungen unter «Daten» eine Kennzahl hinzufügt oder ändert, bekommt eine
eigene Datei `config/kennzahlen.json`. Sie lässt sich auch von Hand pflegen, oder man zeigt
mit `LUMANTIC_METRICS` auf eine andere Datei.

```json
{
  "id": "lcr", "group": "liq", "name": "LCR", "long": "Liquidity Coverage Ratio",
  "unit": "%", "dec": 0, "kind": "stock", "dir": 1, "limit": 100, "target": 125,
  "monthly": { "table": "gold_alco.liquiditaet_monat", "value": "lcr_pct" },
  "daily":   { "table": "gold_alco.liquiditaet_tag", "value": "lcr_pct" },
  "parts":   { "mode": "ratio", "columns": [
    { "name": "HQLA", "column": "hqla_mio_chf" },
    { "name": "Nettomittelabflüsse", "column": "nettomittelabfluesse_mio_chf" } ] }
}
```

- `kind`: `stock` (Bestand am Monatsende) oder `flow` (Summe im Monat).
- `dir`: `1` mehr ist besser, `-1` weniger ist besser, `0` neutral.
- `limit` ist die regulatorische Grenze, `target` das interne Ziel (bei `dir: -1` die Frühwarnung).
- `parts` zerlegt eine Kennzahl: in Spalten (`columns`) oder nach einer Dimension (`split`, z. B. `segment`). `mode` ist `sum`, `ratio` oder `funnel`.
- `daily` ist optional und speist die Tageswerte.

Beim Start prüft Lumantic jede Tabelle und Spalte gegen den Katalog. Fehlt einer Kennzahl
eine Spalte, fällt nur sie weg; die Einstellungen zeigen, was fehlt.

## Datenquelle anbinden

Beim allerersten Start fragt die App «Wo liegt dein Goldlayer?» und zeigt die fünf Arten als
Karten; eine Karte öffnet das passende Formular. Später geht dasselbe in den Einstellungen unter
**Daten**. «Verbindung prüfen» zeigt die gefundenen Tabellen, «Speichern» übernimmt sie.
Scheitert die neue Quelle, bleibt die alte.
Das gilt für den Kosmos, in dem man gerade ist; eine weitere Datenquelle wird ein weiterer
Kosmos (siehe «Mehrere Kosmen»).

- **DuckDB-Datei:** Pfad zur Datei und Schema-Präfix. Beschreibungen kommen aus
  `COMMENT ON TABLE/COLUMN`.
- **Ordner mit Parquet- oder CSV-Dateien:** Jede Datei wird die Tabelle `<schema>.<dateiname>`,
  jeder Unterordner mit Parquet-Dateien ebenfalls. DuckDB liest dabei nur in diesem Ordner.
- **Snowflake:** Konto, Benutzer, Warehouse, Datenbank, Schema und optional eine Rolle. Anmeldung
  mit Schlüsselpaar (empfohlen) oder Token. Lumantic nutzt die SQL API, keinen Treiber.
- **Databricks:** Adresse des Workspace, ID des SQL-Warehouse, Katalog und Schema. Anmeldung
  als Service Principal mit OAuth (empfohlen) oder mit persönlichem Token. Lumantic nutzt die
  SQL Statement Execution API.
- **Windmill:** Die zwei Skripte aus `adapters/windmill/` in Windmill anlegen, dann Adresse,
  Workspace und Token eintragen. Der Adapter ruft
  `POST /api/w/{workspace}/jobs/run_wait_result/p/{pfad}` auf. Das ist noch nicht gegen eine
  echte Windmill-Instanz getestet.

Eine Tabelle braucht eine Datumsspalte (`DATE` oder `TIMESTAMP`), damit Kennzahlen aus ihr
Zeitreihen werden.

Jede Datenbank bekommt ihr eigenes SQL: Lumantic stellt seine Fragen als Struktur (Summen pro
Monat oder Tag, Werte einer Dimension, Zeilen pro Tabelle), und ein Dialekt pro Datenbank schreibt
sie (`internal/adapter/dialect.go`). An Snowflake und Databricks geht nur, was mit `SELECT` oder
`WITH` beginnt und nur eine Anweisung ist. Felder und Einrichtung im Detail: `config/README.md`.
Snowflake und Databricks sind gegen nachgebaute Antworten ihrer Schnittstellen getestet, noch
nicht gegen echte Konten.

## Aktualisierung

Lumantic liest einen Kosmos immer ganz neu, nie nur den neusten Tag; so kommen auch Korrekturen
an alten Tagen mit. Beim Öffnen einer Seite fragt es die Datenbank nie. Neu gelesen wird:

- **auf Anstoss:** Der letzte Schritt des Ladeprozesses ruft `POST /api/refresh?k=<kosmos>` mit
  dem Aktualisierungs-Token des Kosmos auf (`Authorization: Bearer …`, oder als Passwort einer
  Basic-Anmeldung, wie es viele Webhook-Werkzeuge anbieten). Lumantic antwortet sofort mit `202`
  und liest im Hintergrund. Kommt ein Anstoss, während gelesen wird, liest Lumantic danach noch
  einmal, nie öfter. Den Token erzeugt man in den Einstellungen unter **Daten › Aktualisierung**;
  er erscheint einmal, gespeichert wird nur ein Hash. Für Windmill liegt eine Vorlage in
  `adapters/windmill/refresh.py`.
- **zu festen Zeiten**, zum Beispiel täglich um 06:00. Das ist der Standard für Snowflake,
  Databricks und Windmill: Das Warehouse wacht einmal auf.
- **wenn sich Dateien ändern:** Bei einer DuckDB-Datei oder einem Ordner schaut Lumantic alle
  paar Minuten auf Anzahl, Grösse und Zeit der Dateien (Standard: alle 5 Minuten), ohne die
  Daten zu lesen. Für Warehouses gibt es das nicht, weil schon die Frage das Warehouse weckt.
- **von Hand** mit «Neu laden».

`GET /api/refresh?k=<kosmos>` sagt einem Ladeprozess, wie der letzte Lauf ging und wann der
nächste kommt. Offene Seiten hören über `GET /api/events` (Server-Sent Events) von jedem Lauf.
Brachte er neue Zahlen, erscheint oben «Neue Zahlen · Stand 07:42» mit «Zeigen»; eine Seite im
Hintergrund übernimmt sie still und öffnet wieder dort, wo man war.

Liegen die Tagesdateien eines Ladeprozesses in einem Unterordner, ist der Ordner eine Tabelle:
Jeder Tag kommt als Datei dazu, und `union_by_name` hält das aus, wenn später eine Spalte
dazukommt. Ordner der Form `jahr=2026/monat=11/` liest DuckDB als Partitionen.

## Lumina mit Claude

Ohne API-Token sucht Lumina Fragen nach Stichwörtern ab. Mit Token (Einstellungen → Lumina,
oder `ANTHROPIC_API_KEY`) beantwortet Claude die Frage in ein bis drei Sätzen und schlägt
bis zu drei Diagramme vor. Standardmodell ist `claude-opus-5-5`.

Lumina schickt die Frage und die ausgewerteten Kennzahlen des gezeigten Monats an Anthropic
(Wert, Vormonat, Ziel, Limit, Stufe, die letzten 13 Monate, Teile), keine Datenzeilen aus dem
Goldlayer. Das Token liegt in `data/secrets.json`, nie in der Konfiguration, und die App zeigt
davon nur die letzten vier Zeichen. Läuft der Zugang über ein Firmen-Gateway, trägt man dessen
Adresse ein. Die Regeln, Sätze und Empfehlungen auf den Seiten laufen ohne KI.

## Architektur

```
             Browser (web/: Kosmos-Raum in JS, Einstellungen und Designs in TypeScript)
                │  JSON-API
   ┌────────────┴──────────────────────────────────────────┐
   │ Go-Server (ein Programm, Oberfläche eingebettet)       │
   │  config   Einstellungen, Umgebungsvariablen, Tokens    │
   │  source   baut aus den Einstellungen die Datenquelle   │
   │  metrics  Definitionen + Goldlayer → Zeitreihen        │
   │  ai       Claude für Lumina                            │
   │  store    Arbeitsbereich: Seiten, Blöcke, Darstellung  │
   └────────────┬──────────────────────────────────────────┘
                │  zwei Anschlüsse: describe() und query()
        Adapter: duckdb · files (Parquet/CSV) · snowflake · databricks · windmill
                │
        Goldlayer der Teams
```

| Ordner | Inhalt |
|---|---|
| `cmd/lumantic` | Server |
| `cmd/seed` | erzeugt die Beispiel-Goldlayer «ALCO» und «Retail Banking» als DuckDB-Datei, «Firmenkunden» und «Privatkunden» als CSV-Ordner (alle Zahlen erfunden) |
| `config/beispiele/` | Kennzahlen-Definitionen der Beispiel-Kosmen «Firmenkunden» und «Privatkunden» |
| `config/` | Vorlage und Beschreibung der Einstellungen, Firmen-Designs in `brand/` |
| `internal/config` | Einstellungen laden, prüfen, speichern; Tokens |
| `internal/source`, `internal/adapter` | Datenquelle aus den Einstellungen; DuckDB-, Ordner- und Windmill-Adapter, die SQL-Dialekte |
| `internal/adapter/snowflake`, `internal/adapter/databricks` | Snowflake über die SQL API, Databricks über die SQL Statement Execution API |
| `internal/metrics` | Kennzahlen-Definitionen, Prüfung gegen den Katalog, Laden der Zeitreihen, Bearbeiten |
| `internal/ai`, `internal/lumina` | Claude für Lumina; Fragen-Karten der ersten Oberfläche |
| `internal/server` | HTTP-API |
| `web/src/kosmos/` | der Raum: nummerierte JS-Teile, die `vite.config.ts` zu einem Modul zusammenfügt |
| `web/src/menu.ts`, `logo.ts` | Hauptmenü der Kosmen; das Logo, an einer Stelle |
| `web/src/settings.ts`, `themes.ts`, `prefs.ts`, `main.ts` | Einstellungen, Designs, gespeicherte Wahl, Start |
| `web/src/styles/` | `themes.css` (die Designs), `kosmos.css`, `settings.css`, `app.css` |
| `design/` | Entwürfe und Begründungen, frühere Oberflächen in `archive/` |
| `adapters/windmill` | Vorlagen für die Windmill-Skripte: Struktur, Abfragen und der Anstoss nach einem Flow |

### API

| | |
|---|---|
| `GET /api/metrics` | Kennzahlen mit Monats- und Tagesreihen, Teilen und Ereignissen (503 ohne Daten) |
| `GET /api/workspace`, `PUT /api/workspace` | Seiten, Blöcke und die persönliche Darstellung |
| `GET /api/settings`, `PUT /api/settings` | Einstellungen für alle (Tokens nie im Klartext) |
| `POST /api/settings/data/test` | eine Datenquelle prüfen, ohne zu speichern |
| `PUT /api/settings/secret` | einen Token setzen oder entfernen; die von Snowflake und Databricks gehören zum Kosmos aus `?k=` |
| `POST /api/refresh` | einen Kosmos neu lesen: mit Aktualisierungs-Token sofort `202` und im Hintergrund, aus der App wartend |
| `GET /api/refresh` | Stand des letzten Laufs, Dauer, Auslöser und der nächste Termin |
| `POST`/`DELETE /api/refresh/token` | den Aktualisierungs-Token eines Kosmos erzeugen (einmal angezeigt) oder entfernen |
| `GET /api/events` | Meldungen an offene Seiten, wenn ein Kosmos neu gelesen wurde (Server-Sent Events) |
| `POST /api/settings/ai/test` | eine kurze Anfrage an Claude |
| `POST /api/refresh` | Katalog und Kennzahlen neu lesen |
| `GET/POST /api/kpis`, `PUT/DELETE /api/kpis/{id}` | Kennzahlen-Definitionen |
| `POST /api/lumina/ask` | eine Frage an Lumina mit den Fakten des Monats |
| `GET /api/catalog` | der Katalog, wie Lumina ihn sieht |
| `GET/POST /api/kosmen`, `DELETE /api/kosmen/{id}` | alle Kosmen mit Status; einen weiteren anlegen; einen entfernen |
| `GET /brand/…` | Logo und Schriften aus `config/brand/` |

Alles, was einen Kosmos betrifft (Kennzahlen, Arbeitsbereich, Datenquelle, Katalog), nimmt
`?k=<id>`; ohne ist der erste Kosmos gemeint. Anfragen, die etwas ändern, müssen JSON sein und
von derselben Seite kommen.

## Tests

```powershell
go test ./...
cd web; npm run build; cd ..
node scripts/ui-test/run.mjs     # Oberfläche in Echtzeit: ein Kosmos (Desktop, Handy, reduzierte Bewegung), Hauptmenü mit dreien
```

`run.mjs` startet einen Testserver mit festen Kennzahlen (`scripts/ui-test/mock-api.mjs`),
spielt die App in Edge ohne Fenster mit echten Tasten und Klicks durch und legt
Bildschirmfotos in `scripts/ui-test/shots/` ab.

## Nächste Schritte

- Anmeldung (SSO): Arbeitsbereich pro Person, und wer welchen Kosmos sieht; heute sehen alle alles und teilen sich die Seiten
- Kennzahlen eines neuen Kosmos aus seinen Tabellen vorschlagen, und andere Einheiten als %, Mio. und Mrd. CHF
- Lagebericht als Nachricht in Teams oder per Mail, jeden Morgen
- Windmill, Snowflake und Databricks gegen echte Instanzen testen
- Korrektur für Mehrfachvergleiche, wenn Lumina sehr viele Reihen prüft
