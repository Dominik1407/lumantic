# Lumantic

**Quiet until it matters.**

Lumantic ist eine ruhige Oberfläche über dem Goldlayer eines Teams. Seiten aus Bausteinen
liegen in einem Raum: Aus der Nähe liest man sie wie einen Brief, aus der Ferne falten sie
sich zu Sternbildern. Lumina, die Assistentin, schreibt «Heute» und eine Seite pro Thema und
begründet jede Wahl. Alles andere baut man selbst, und es bleibt gespeichert.

Der Name: **Lum**en (Licht) + Se**mantic** (Bedeutung). Bedeutung ans Licht bringen.

[English](README.md)

```
Bronze    →  Rohdaten
Silver    →  bereinigt
Gold      →  fertige Kennzahlen pro Team
Lumantic  →  die Bedeutung, für alle verständlich
```

## Schnellstart

**Herunterladen.** Die Datei für dein System von den
[Releases](https://github.com/Dominik1407/lumantic/releases) laden (Windows, macOS, Linux),
entpacken und `lumantic` starten, unter Windows mit Doppelklick auf `lumantic.exe`. Der Browser
öffnet sich mit zwei Beispiel-Kosmen, Industrie und ALCO, deren Zahlen bis zum letzten Monat
reichen. Installieren muss man nichts, DuckDB ist eingebaut. Den eigenen Goldlayer, etwa einen
Ordner mit Parquet- oder CSV-Dateien, verbindest du danach unter **Einstellungen › Daten** (er
ersetzt das Beispiel) oder mit «Kosmos hinzufügen» im Hauptmenü.

Die Dateien sind noch nicht signiert. Windows SmartScreen warnt beim ersten Start: «Weitere
Informationen», dann «Trotzdem ausführen». macOS sperrt die Datei: im Finder mit Rechtsklick ›
Öffnen starten, oder im Terminal `xattr -d com.apple.quarantine lumantic`.

**Mit Docker.**

```sh
docker run -p 127.0.0.1:8080:8080 -v lumantic-data:/data ghcr.io/dominik1407/lumantic
```

Ohne Anmeldung zeigt das Image nur die Beispiele. **Neben dem Lakehouse** nimmt
[docker-compose.yml](docker-compose.yml) den Goldlayer als Ordner, nur lesend, die Daten von
Lumantic in ein Volume, und hat die Anmeldung als Vorlage: `docker compose up -d`.

Wo Lumantic Einstellungen, Tokens und Arbeitsstände ablegt, steht in
[config/README.md](config/README.md) unter «Datenort». Datenquelle, Kennzahlen, KI und Design
stellt man in der App unter **Einstellungen** ein (Zahnrad am Ende der Leiste unten, oder
Taste `,`).

### Aus dem Quellcode

Voraussetzungen: Go 1.25+ und Node 20+. Mit einem C-Compiler (gcc oder clang; unter Windows
MinGW-w64 mit gcc 15, das gcc 16 von MSYS2 passt nicht zu DuckDBs Bibliothek) baut Go DuckDB
ein; ohne fragt Lumantic die DuckDB-CLI (`winget install DuckDB.cli`).

```powershell
.\scripts\run.ps1          # baut alles und startet auf http://127.0.0.1:8080
.\scripts\run.ps1 -Seed    # Beispiel-Goldlayer neu erzeugen
```

In einem Ordner mit `config/lumantic.json` (oder mit `LUMANTIC_CONFIG`) bleiben alle Pfade
relativ zum Arbeitsordner, wie es zum Entwickeln passt.

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
- **Lesen und zoomen:** Das Mausrad über einer langen Seite scrollt sie wie Text; neben der
  Seite zoomt es hinein und heraus. Ziehen verschiebt den Raum.
- **Tasten:** Unten links neben «Idee» zeigt «Tasten» (oder `?`) alle Tastenkürzel. Eine
  gedrückte Taste leuchtet dort auf.

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

`.\scripts\run.ps1 -Seed` erzeugt neben «ALCO» drei weitere Beispiel-Goldlayer als Ordner mit
CSV-Dateien: «Firmenkunden», «Privatkunden» und «Industrie», das Controlling eines erfundenen
Herstellers von Antrieben und Steuerungen (Umsatz, Auftragseingang, EBIT-Marge, OEE,
Liefertreue, Gutteile, Ausschuss, Lagerreichweite). Ohne die DuckDB-Datei neu zu bauen, schreibt
`go run ./cmd/seed -folders` nur die Ordner. Ihre Kennzahlen liegen in `config/beispiele/`,
[config/lumantic.example.json](config/lumantic.example.json) verbindet alle vier.

Wer welchen Kosmos sieht, regelt die Anmeldung (siehe «Anmeldung und Rechte»).

### Tasten

| Taste | |
|---|---|
| `H` | Heute |
| `K` | zurück ins Hauptmenü (bei mehreren Kosmen) |
| `C` | Sternkatalog: im Raum der Katalog dieses Kosmos, im Hauptmenü der aller Kosmen |
| `1` bis `9` | Themen-Seite öffnen, im Hauptmenü einen Kosmos |
| `0` | Überblick über alle Seiten |
| `←` `→` | eine Periode zurück oder vor (Monat, Quartal oder Jahr), mit `Shift` ein Jahr |
| `G` | Raster wechseln: Tag, Woche, Monat, Quartal, Jahr |
| `Z` | zwischen jetzt und dem letzten Monat in der Vergangenheit wechseln |
| `Leertaste` | Geschichte abspielen oder anhalten |
| `/` | Baustein einfügen |
| `↑` `↓` | weiterlesen |
| `Tab` | Luminas Vorschlag übernehmen |
| `Entf` | gewählten Baustein entfernen |
| `,` | Einstellungen |
| `?` | alle Tasten auf einen Blick |
| `I` | die Idee und ihre Quellen |
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

### Sprache

Lumantic spricht Deutsch und Englisch. Unter Darstellung › Sprache wählt jede Person «Wie der
Browser», Deutsch oder English; «Für alle speichern» macht die Wahl zum Standard des Teams
(`ui.language`: `de`, `en` oder leer). Englisch liest Zahlen international (`CHF 92m`,
`CHF 1.2bn`, `1,150.5`, `12.5%`, `Oct 2026`), Deutsch bleibt schweizerisch (`92 Mio. CHF`, `1’150.5`).

Lumantic übersetzt nur seine eigenen Texte: den Raum, Luminas Sätze, das Hauptmenü, die
Einstellungen, den Sternkatalog und die Meldungen des Servers. Lumina antwortet in der Sprache
der Oberfläche. Was ein Team definiert, bleibt, wie es ist; englische Wörter stehen daneben unter
`en` (siehe «Kennzahlen definieren»), im Fachkatalog in Spalten mit `_en`. Fehlt ein englisches
Wort, steht das deutsche. Wer in Englisch eine Definition im Sternkatalog ändert, ändert ihre
englischen Wörter; die deutschen bleiben.

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

- `kind`: wie die Kennzahl über ein Quartal oder Jahr zusammenkommt: `stock` (Bestand am
  Periodenende), `flow` (Summe), `avg` (Durchschnitt der Monate, etwa die Zinsmarge) oder
  `ratio` (Verhältnis: Zähler und Nenner je für sich zusammengezählt, dann geteilt; braucht
  `parts` mit `mode: "ratio"`).
- `dir`: `1` mehr ist besser, `-1` weniger ist besser, `0` neutral.
- `limit` ist die regulatorische Grenze, `target` das interne Ziel (bei `dir: -1` die Frühwarnung).
- `parts` zerlegt eine Kennzahl: in Spalten (`columns`) oder nach einer Dimension (`split`, z. B. `segment`). `mode` ist `sum`, `ratio` oder `funnel`.
  Bei `ratio` sagt `kind`, wie Zähler und Nenner zusammenkommen: `stock` (am Stichtag, wie bei
  der LCR) oder `flow` (summiert, wie bei der Ausschussquote: Ausschuss ÷ gefertigte Teile).
- `daily` ist optional: eine Tabelle mit einer Zeile pro Tag (oder pro Tag und Teil). Sie speist die Tageswerte und
  macht die Kennzahl auch in Wochen und Tagen lesbar. Prozente brauchen eine Zeile pro Tag, denn Lumantic summiert die
  Zeilen eines Tages.

Beim Start prüft Lumantic jede Tabelle und Spalte gegen den Katalog. Fehlt einer Kennzahl
eine Spalte, fällt nur sie weg; die Einstellungen zeigen, was fehlt.

Einheiten (`unit`): `%`, Geld in Mio. CHF (`Mio`, als Mrd. gezeigt mit `Mrd`, `Tsd` für
Tausend CHF), `Stk` (Stück), `Tage`, `h` (Stunden) und `Zahl`. Dazu kommen Felder für den
Katalog: `formula` (die Berechnung in Worten), `owner` (wer für die Kennzahl geradesteht) und
`bounds`, Ziele und Grenzen mit Gültigkeit, etwa ein Budget pro Jahr:

```json
"bounds": [ { "kind": "ziel", "value": 8.0, "name": "Budget 2025", "from": "2025-01", "until": "2025-12" },
            { "kind": "ziel", "value": 9.0, "name": "Budget 2026", "from": "2026-01" } ]
```

Bei einem Fluss ist ein solches Ziel ein **Jahresbudget**, ausser es sagt `"per": "monat"`. Ein einzelnes
`target` gilt wie bisher pro Monat; mit `"targetPer": "jahr"` ist es ein Jahresziel. Lumantic verteilt ein
Jahresziel nach dem Branchenstandard: ein Zwölftel pro Monat, im Monat gleichmässig auf die Arbeitstage Montag
bis Freitag. Umstellen lässt sich das pro Kennzahl mit `phasing` (auch im Sternkatalog unter «Verteilung»):
`arbeitstage` (das Jahr nach seinen Arbeitstagen), `kalendertage` (nach allen Tagen) oder `profil` mit
`"profile": [12 Gewichte]`, zum Beispiel mehr am Quartalsende. `phasing` ganz oben in der Datei gilt für alle.

Englische Wörter stehen unter `en`, für die englische Oberfläche: bei einer Kennzahl `name`, `long`, `short`,
`desc`, `targetName` und `limitName`, bei einer Gruppe `name`, bei einem Ereignis `title` und `text`, ganz oben
`title` und `source`, bei einem Begriff `term` und `definition`, in `extra` dazu `formula`.

```json
"en": { "name": "Interest margin", "short": "NIM", "desc": "Net interest income relative to interest-earning assets, annualised." }
```

## Zeitraster: Tag, Woche, Monat, Quartal, Jahr

Neben dem Datum auf «Heute» steht die Wahl des Rasters: **Tag**, **Woche**, **Monat**,
**Quartal** oder **Jahr** (Taste `G`). Im Quartal zeigt jede Seite das Quartal, die Sätze vergleichen mit dem Vorquartal,
die Diagramme beschriften ihre Achse in Quartalen, und `←` `→` gehen ein Quartal. Quartal und
Jahr entstehen aus den Monaten, nach der Art der Kennzahl: ein Bestand zählt mit seinem letzten
Monat, ein Fluss wird summiert, ein Durchschnitt gemittelt, ein Verhältnis aus Zähler und Nenner
gerechnet. Prozente werden nie gemittelt, wenn ihre Teile bekannt sind.

Ein laufendes Quartal heisst «Q4 2026 bis Oktober». Ein Fluss darin wird mit denselben Monaten
des Vorjahrs verglichen und mit dem Ziel bis heute, nicht mit dem ganzen.

**Woche und Tag** gibt es, sobald eine Kennzahl eine Tagestabelle hat (`daily`). Wochen zählen nach
ISO 8601 ab Montag und entstehen nur aus Tagen, nie aus Monaten: «KW 46 2026». Eine laufende Woche
heisst «KW 46 2026 bis Dienstag» und wird mit denselben Tagen der Vorwoche verglichen. Ein Tag ohne
Zeile ist leer, nie null. Das Wochen- oder Tagesziel eines Flusses ist die Summe seiner Tage (siehe
Jahresbudget oben). Eine Kennzahl ohne Tageswerte bleibt in Woche und Tag bei ihrem Monat und sagt
«nur monatlich erhoben». Der Server schickt die Tage der letzten 90 Tage und die Wochen der letzten
zwei Jahre.

Der Status hat ein festes Raster: «Heute» und das Hauptmenü urteilen im **Standardraster** des
Kosmos (Einstellungen → Daten → Raster, Standard Monat), damit eine Kennzahl beim Umschalten
nicht von ruhig auf rot springt. Die Themen-Seiten urteilen im Raster, in dem man liest. Das
gewählte Raster merkt sich der Arbeitsbereich.

## Katalog: was die Zahlen bedeuten

Jeder Kosmos hat einen **Sternkatalog** (Taste `C`, oder «Katalog» in der Leiste unten): jede
Kennzahl als Eintrag mit Definition, Berechnung, Quelle, Einheit, Art, Richtung, Zielen über die
Zeit und Eigner, dazu die Begriffe des Hauses mit Synonymen und die Tabellen darunter. Im
Hauptmenü durchsucht er alle Kosmen. Lumina bekommt die Definitionen und Begriffe mit und
versteht so «Termintreue» als Liefertreue.

Die Bedeutung kommt aus drei Quellen, Feld für Feld in dieser Reihenfolge, und jedes Feld zeigt
seine Herkunft:

1. ● **Fachkatalog in der Quelle:** drei Tabellen oder Views mit festen Namen im Goldlayer
   (`lumantic_kennzahlen`, `lumantic_ziele`, `lumantic_begriffe`). Gibt es sie, baut sich ein
   Kosmos aus ihnen, ohne Kennzahlen-Datei. Was dort steht, ändert man dort.
2. ○ **In Lumantic ergänzt:** eigene Kennzahlen in der Kennzahlen-Datei, und was der Fachkatalog
   offen lässt (`extra`, zum Beispiel ein Ziel oder eine Definition). Das ergänzt man direkt im
   Sternkatalog.
3. ◌ **Vermutet:** Einheit und Art aus dem Spaltennamen (`_pct` ist Prozent, `_mio` Mio. CHF,
   `_stk` Stück), immer nur ein Vorschlag.

Lumantic schreibt nie in die Datenbank. Wer einen in Lumantic begonnenen Katalog in den Goldlayer
übernehmen will, lädt ihn im Sternkatalog unter «Tabellen» als SQL herunter: Es legt die drei
Views an, und von da an liest Lumantic den Katalog aus der Quelle. Englische Wörter stehen im
Fachkatalog in den Spalten `name_en`, `definition_en`, `thema_en` und `begriff_en`. Vertrag und Spalten im Detail:
`config/README.md`, Abschnitt «Katalog». Der Beispiel-Kosmos «Industrie» zeigt alle drei
Herkünfte.

## Datenquelle anbinden

Unter **Einstellungen › Daten** wählt man eine der fünf Arten; «Verbindung prüfen» zeigt die
gefundenen Tabellen, «Speichern» übernimmt sie. Scheitert die neue Quelle, bleibt die alte. Das
gilt für den Kosmos, in dem man gerade ist; eine weitere Datenquelle wird ein weiterer Kosmos
(siehe «Mehrere Kosmen»). In einem Quellcode-Ordner ohne Einstellungen fragt der allererste Start
«Wo liegt dein Goldlayer?» mit den fünf Arten als Karten.

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
an alten Tagen mit. Beim Öffnen einer Seite fragt es die Datenbank nie: Die Zahlen kommen aus dem
Speicher. Neu gelesen wird:

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

## Anmeldung und Rechte

Ohne Anmeldung ist Lumantic für einen Rechner: Alle dürfen alles, und es hört nur auf `127.0.0.1`. Von aussen erreichbar
(etwa im Container) zeigt es ohne Anmeldung nur die Beispiele. Für mehrere Personen
meldet man sich über einen Proxy davor an (zum Beispiel einen Authentik-Outpost) oder mit OpenID Connect (Authentik,
Entra ID, Keycloak, ADFS). Die Windows-Anmeldung übernimmt dabei der Anbieter. Lumantic hat keine eigenen Benutzer
und keine Passwörter. Es nimmt Konto, Name und Gruppen aus der Anmeldung:

- **Administratoren** (`auth.admins`) ändern Datenquellen, Lumina und Kosmen und sehen alle Kosmen.
- **Ein Kosmos** zeigt sich nur den Gruppen unter `access`; die anderen sehen ihn auch im Hauptmenü nicht.
- **Kennzahlen pflegen** dürfen Administratoren und die Gruppen unter `editors`.
- **Eine Kennzahl** kann eigene Gruppen haben (`access` in der Kennzahlen-Datei).
- **Im Namen der Person:** Bei Snowflake und Databricks kann Lumantic mit der Anmeldung der Person fragen
  (`rights: "source"`); dann gelten die Rechte der Datenbank, auch Zeilenfilter und Masken.

Jede Person hat ihre eigenen Seiten, und `data/zugriff.log` hält fest, wer sich anmeldet und welchen Kosmos öffnet.
Einrichtung im Detail: `config/README.md`, Abschnitt «Anmeldung und Rechte».

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
| `cmd/seed` | erzeugt zum Entwickeln die Beispiel-Goldlayer «ALCO» und «Retail Banking» als DuckDB-Datei, «Firmenkunden», «Privatkunden» und «Industrie» als CSV-Ordner (alle Zahlen erfunden) |
| `internal/beispiele` | die Beispiele selbst: Geschichten in Zahlen, die immer im letzten Monat enden; der erste Start schreibt Industrie und ALCO |
| `config/beispiele/` | Kennzahlen-Definitionen der Beispiel-Kosmen «Industrie», «Firmenkunden» und «Privatkunden» |
| `config/` | Vorlage und Beschreibung der Einstellungen, Firmen-Designs in `brand/` |
| `internal/config` | Einstellungen laden, prüfen, speichern; Tokens |
| `internal/auth` | Anmeldung: keine, über einen Proxy oder mit OpenID Connect |
| `internal/katalog` | Fachkatalog lesen, mit Lumantics Definitionen und Vermutungen zusammenführen, als SQL ausgeben |
| `internal/source`, `internal/adapter` | Datenquelle aus den Einstellungen; DuckDB-, Ordner- und Windmill-Adapter, die SQL-Dialekte; DuckDB eingebaut (`duckdb_builtin.go`, mit cgo) oder als CLI |
| `internal/adapter/snowflake`, `internal/adapter/databricks` | Snowflake über die SQL API, Databricks über die SQL Statement Execution API |
| `internal/metrics` | Kennzahlen-Definitionen, Prüfung gegen den Katalog, Laden der Zeitreihen, Bearbeiten |
| `internal/ai`, `internal/lumina` | Claude für Lumina; Fragen-Karten der ersten Oberfläche |
| `internal/server` | HTTP-API |
| `internal/i18n` | Lumantics Meldungen auf Englisch: die deutschen Formate mit ihrer Übersetzung, angewandt am Rand der API |
| `web/src/kosmos/` | der Raum: nummerierte JS-Teile, die `vite.config.ts` zu einem Modul zusammenfügt |
| `web/src/menu.ts`, `logo.ts` | Hauptmenü der Kosmen; das Logo, an einer Stelle |
| `web/src/settings.ts`, `themes.ts`, `prefs.ts`, `main.ts` | Einstellungen, Designs, gespeicherte Wahl, Start |
| `web/src/i18n.ts` | die Sprache der Oberfläche; Texte stehen zweisprachig am Ort: `tr("Heute", "Today")` |
| `web/src/styles/` | `themes.css` (die Designs), `kosmos.css`, `settings.css`, `app.css` |
| `design/` | Entwürfe und Begründungen, frühere Oberflächen in `archive/` |
| `adapters/windmill` | Vorlagen für die Windmill-Skripte: Struktur, Abfragen und der Anstoss nach einem Flow |

### API

| | |
|---|---|
| `GET /api/metrics` | Kennzahlen mit Monats-, Wochen- und Tagesreihen, Teilen, Ereignissen und dem Standardraster (503 ohne Daten) |
| `GET /api/workspace`, `PUT /api/workspace` | Seiten, Blöcke und die persönliche Darstellung |
| `GET /api/settings`, `PUT /api/settings` | Einstellungen für alle (Tokens nie im Klartext) |
| `POST /api/settings/data/test` | eine Datenquelle prüfen, ohne zu speichern |
| `PUT /api/settings/secret` | einen Token setzen oder entfernen; die von Snowflake und Databricks gehören zum Kosmos aus `?k=` |
| `POST /api/refresh` | einen Kosmos neu lesen: mit Aktualisierungs-Token sofort `202` und im Hintergrund, aus der App wartend |
| `GET /api/refresh` | Stand des letzten Laufs, Dauer, Auslöser und der nächste Termin |
| `POST`/`DELETE /api/refresh/token` | den Aktualisierungs-Token eines Kosmos erzeugen (einmal angezeigt) oder entfernen |
| `GET /api/events` | Meldungen an offene Seiten, wenn ein Kosmos neu gelesen wurde (Server-Sent Events) |
| `GET /api/me` | wer angemeldet ist und was diese Person ändern darf |
| `GET /api/katalog` | der Sternkatalog eines Kosmos: Einträge mit Herkunft je Feld, Begriffe, Tabellen |
| `PUT /api/katalog/kennzahl/{id}`, `PUT /api/katalog/begriffe` | ergänzen, was der Fachkatalog offen lässt; die Begriffe von Lumantic |
| `GET /api/katalog/export?format=sql` | den Katalog als SQL für die drei Views im Goldlayer (oder `json`) |
| `/auth/login`, `/auth/callback`, `/auth/logout` | Anmeldung mit OpenID Connect; beim Proxy nur das Abmelden |
| `POST /api/settings/ai/test` | eine kurze Anfrage an Claude |
| `GET/POST /api/kpis`, `PUT/DELETE /api/kpis/{id}` | Kennzahlen-Definitionen |
| `POST /api/lumina/ask` | eine Frage an Lumina mit den Fakten des Monats |
| `GET /api/catalog` | der Katalog, wie Lumina ihn sieht |
| `GET/POST /api/kosmen`, `DELETE /api/kosmen/{id}` | alle Kosmen mit Status; einen weiteren anlegen; einen entfernen |
| `GET /brand/…` | Logo und Schriften aus `config/brand/` |
| `GET /healthz` | ob Lumantic läuft, ohne Anmeldung (für Container; `lumantic health` fragt danach) |

Alles, was einen Kosmos betrifft (Kennzahlen, Arbeitsbereich, Datenquelle, Katalog), nimmt
`?k=<id>`; ohne ist der erste Kosmos gemeint. Anfragen, die etwas ändern, müssen JSON sein und
von derselben Seite kommen. Die API antwortet auf Englisch, wenn `Accept-Language` mit `en` beginnt,
das Cookie `lumantic_lang=en` gesetzt ist oder `?lang=en` dasteht.

## Tests

```powershell
go test ./...
cd web; npm run build; cd ..
node scripts/ui-test/run.mjs     # Oberfläche in Echtzeit: ein Kosmos (Desktop, Handy, reduzierte Bewegung), Hauptmenü mit dreien, kurzes Fenster, Raster, Englisch
```

Die CI prüft beide Wege von DuckDB, eingebaut und als CLI, auf Linux und Windows. Ein Tag `v*` baut
die Dateien für fünf Systeme und das Image, probiert jedes einmal aus und veröffentlicht sie
(`.github/workflows/release.yml`).

`run.mjs` startet einen Testserver mit festen Kennzahlen (`scripts/ui-test/mock-api.mjs`),
spielt die App in Edge ohne Fenster mit echten Tasten und Klicks durch und legt
Bildschirmfotos in `scripts/ui-test/shots/` ab.

## Nächste Schritte

- Rechte auf einzelne Teile einer Kennzahl (Region Ost sieht nur Ost) und Rechte wie die Windows-Ordnerrechte
- Kennzahlen eines neuen Kosmos aus seinen Tabellen vorschlagen
- Feiertage beim Verteilen von Zielen auf Arbeitstage (je nach Kanton)
- Lagebericht als Nachricht in Teams oder per Mail, jeden Morgen
- Windmill, Snowflake und Databricks gegen echte Instanzen testen
- Korrektur für Mehrfachvergleiche, wenn Lumina sehr viele Reihen prüft

## Mitmachen

Ideen und Fehler sind als Issue jederzeit willkommen. Pull Requests bitte erst nach Absprache in
einem Issue; wie das geht und wo Hilfe am meisten bringt, steht in
[CONTRIBUTING.md](CONTRIBUTING.md) (englisch). Sicherheitslücken bitte privat melden, siehe
[SECURITY.md](SECURITY.md).

## Lizenz

Lumantic steht unter der [Apache License 2.0](LICENSE). Hinweise zu den mitgelieferten Schriften
stehen in [NOTICE](NOTICE); die Lizenzen von allem anderen im Programm liegen jedem Release als
`THIRD_PARTY_NOTICES.txt` bei.
