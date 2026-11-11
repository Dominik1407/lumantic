# Einstellungen von Lumantic

Lumantic liest seine Einstellungen aus `config/lumantic.json`. Die Datei entsteht, sobald jemand in der App unter
«Einstellungen» etwas speichert. Bis dahin gelten die Standardwerte. Eine vollständige Vorlage mit allen Feldern und einem
Firmendesign liegt in `lumantic.example.json`. Kopieren, umbenennen und anpassen genügt.

| Abschnitt | Wofür |
|---|---|
| `data` | Woher die Zahlen kommen: `duckdb` (eine DuckDB-Datei), `files` (ein Ordner mit Parquet- oder CSV-Dateien, jede Datei wird eine Tabelle `<schema>.<dateiname>`; ein Unterordner mit Parquet-Dateien ebenfalls), `snowflake`, `databricks` (siehe unten) oder `windmill` (zwei Skripte im Windmill-Workspace, Vorlagen in `adapters/windmill/`). |
| `metrics` | Datei mit den Kennzahlen (Ziel, Limit, Richtung, Tabelle, Spalte). Leer heisst: die eingebauten ALCO-Kennzahlen. Wer in der App eine Kennzahl ändert oder hinzufügt, bekommt `config/kennzahlen.json`. |
| `kosmen` | Weitere Kosmen neben dem ersten (siehe unten). `data` und `metrics` oben sind der erste Kosmos. |
| `refresh` | Wann der erste Kosmos von selbst neu gelesen wird (siehe «Aktualisierung»). Fehlt es, gilt das Übliche für seine Datenquelle. |
| `ai` | Lumina mit Claude: an oder aus, Modell, und optional eine Adresse für ein Firmen-Gateway. |
| `ui` | Die Standard-Darstellung für alle. Jede Person kann sie in der App für sich ändern. |
| `brand` | Firmenname, eigenes Logo und eigene Designs (siehe unten). |

## Tokens

Tokens stehen nie in dieser Datei, sondern in `data/secrets.json` (wird von der App geschrieben, nur für den eigenen
Benutzer lesbar). Die App zeigt von einem Token nur die letzten vier Zeichen.

Die Tokens von Snowflake und Databricks gehören zu einem Kosmos. Für den ersten heissen sie `snowflakeToken`,
`databricksToken` und `databricksSecret`, für jeden weiteren `snowflakeToken@<id>` und so fort. Wird ein Kosmos
entfernt, gehen seine Tokens mit. Den Claude-Token und den Windmill-Token teilen sich alle Kosmen.

## Umgebungsvariablen

Eine Umgebungsvariable gewinnt immer gegen die Datei. Die App zeigt solche Felder als «durch Umgebungsvariable gesetzt» an.

| Variable | Feld |
|---|---|
| `LUMANTIC_CONFIG` | Pfad dieser Datei (Standard `config/lumantic.json`) |
| `LUMANTIC_SECRETS` | Pfad der Token-Datei (Standard `data/secrets.json`) |
| `LUMANTIC_ADAPTER`, `LUMANTIC_GOLD`, `LUMANTIC_SCHEMA`, `LUMANTIC_SOURCE`, `LUMANTIC_DUCKDB` | `data.type`, `data.path`, `data.schema`, `data.name`, `data.duckdb` |
| `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_ROLE`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_PRIVATE_KEY_FILE`, `SNOWFLAKE_TOKEN` | `data.snowflake.*` und der Snowflake-Token |
| `DATABRICKS_HOST`, `DATABRICKS_WAREHOUSE_ID`, `DATABRICKS_CATALOG`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_TOKEN` | `data.databricks.*`, das Secret des Service Principal und das persönliche Token |
| `WINDMILL_URL`, `WINDMILL_WORKSPACE`, `WINDMILL_DESCRIBE`, `WINDMILL_QUERY`, `WINDMILL_TOKEN` | `data.windmill.*` und der Windmill-Token |
| `LUMANTIC_METRICS` | `metrics` |
| `LUMANTIC_REFRESH_TOKEN` | der Aktualisierungs-Token des ersten Kosmos, im Klartext (sonst in der App erzeugen) |
| `LUMANTIC_LUMINA` (`claude` oder `beispiel`), `LUMANTIC_MODEL`, `ANTHROPIC_BASE_URL` | `ai.enabled`, `ai.model`, `ai.baseURL` |
| `ANTHROPIC_API_KEY` oder `ANTHROPIC_AUTH_TOKEN` | der Claude-Token |
| `LUMANTIC_ADDR`, `LUMANTIC_DATA` | Adresse des Servers, Datei mit dem Arbeitsbereich |

## Snowflake und Databricks

Lumantic spricht mit beiden über ihre offizielle REST-Schnittstelle: die Snowflake SQL API und die Databricks SQL
Statement Execution API. Ein Treiber ist nicht nötig. Lumantic schickt nur lesende Abfragen und weist alles andere schon
selbst ab. Trotzdem bekommt es eine Rolle, die nur lesen darf. Beim ersten Start fragt die App «Wo liegt dein
Goldlayer?» und führt durch dieselben Felder.

**Snowflake**

```json
"data": {
  "type": "snowflake", "name": "Gold", "schema": "GOLD",
  "snowflake": { "account": "myorg-myaccount", "user": "LUMANTIC", "warehouse": "LUMANTIC_XS", "database": "ANALYTICS",
                 "role": "LUMANTIC_READER", "auth": "keypair", "keyFile": "config/keys/lumantic.p8" }
}
```

- `account` ist der Teil vor `.snowflakecomputing.com`. `schema` ist ein Anfang: `GOLD` zeigt auch `GOLD_RISIKO`. Leer heisst alle Schemas.
- `auth: "keypair"` (empfohlen) meldet einen technischen Benutzer mit eigenem Schlüsselpaar an. `keyFile` ist die
  PEM-Datei mit dem privaten Schlüssel, unverschlüsselt (PKCS#8). Sie bleibt auf dem Server; schütze die Datei.
  Schlüssel erzeugen und hinterlegen:

  ```
  openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -out lumantic.p8 -nocrypt
  openssl rsa -in lumantic.p8 -pubout -out lumantic.pub
  ALTER USER LUMANTIC SET RSA_PUBLIC_KEY='<Inhalt von lumantic.pub ohne die BEGIN/END-Zeilen>';
  ```

- `auth: "token"` nimmt ein Programmatic Access Token oder ein OAuth-Token. Es wird in der App gespeichert (oder `SNOWFLAKE_TOKEN`).
- Warehouse, Datenbank und Rolle so schreiben, wie Snowflake sie führt, meist in Grossbuchstaben.
- Jede Abfrage kostet Credits. Lumantic fragt nur beim Laden und bei «Neu laden», nie beim Öffnen einer Seite. Ein kleines
  Warehouse mit Auto-Suspend reicht.

**Databricks**

```json
"data": {
  "type": "databricks", "name": "Gold", "schema": "gold",
  "databricks": { "host": "https://adb-1234567890123456.7.azuredatabricks.net", "warehouse": "1a2b3c4d5e6f7a8b",
                  "catalog": "main", "auth": "oauth", "clientId": "<Application-ID>" }
}
```

- `warehouse` ist die ID des SQL-Warehouse aus seinen Verbindungsdetails. Ein Serverless-Warehouse startet in Sekunden.
- `catalog` ist der Katalog im Unity Catalog; die Tabellen heissen dann `schema.tabelle`. Leer heisst der Standard des Warehouse.
- `auth: "oauth"` (empfohlen) meldet einen Service Principal an: die Client-ID steht hier, das Secret wird in der App
  gespeichert (oder `DATABRICKS_CLIENT_SECRET`). Er braucht `USE CATALOG`, `USE SCHEMA` und `SELECT` auf dem Schema und
  das Recht, das Warehouse zu benutzen.
- `auth: "token"` nimmt ein persönliches Token, zum Ausprobieren (oder `DATABRICKS_TOKEN`).

## Aktualisierung

```json
"refresh": { "daily": ["06:00", "12:30"], "watch": 0 }
```

- `daily` sind Uhrzeiten, zu denen Lumantic den Kosmos neu liest, in der Zeitzone des Servers. Höchstens acht.
- `watch` sind Minuten zwischen zwei Blicken auf die Dateien einer DuckDB-Datei oder eines Ordners; `0` heisst nie. Bei
  Snowflake, Databricks und Windmill gilt immer `0`, weil schon die Frage nach Änderungen das Warehouse weckt.
- Ohne `refresh` gilt das Übliche: Dateien alle 5 Minuten anschauen, ein Warehouse täglich um 06:00 lesen.
- Ein Ladeprozess kann jederzeit anstossen: `POST /api/refresh?k=<id>` mit `Authorization: Bearer <token>`. Den Token
  erzeugt man in der App unter Daten › Aktualisierung; in `data/secrets.json` steht nur `<letzte vier>:<sha256>`. Für
  den ersten Kosmos geht auch `LUMANTIC_REFRESH_TOKEN`.
- Weitere Kosmen haben `refresh` in ihrem Eintrag unter `kosmen`.

## Mehrere Kosmen

Ein Kosmos ist ein Raum über einer Datenquelle. `data` und `metrics` ganz oben sind der erste. Jede weitere Datenquelle
steht unter `kosmen`, und die App öffnet dann in einem Hauptmenü, das zu allen führt:

```json
"kosmen": [
  { "id": "firmenkunden",
    "data": { "type": "files", "name": "Firmenkunden", "path": "goldlayer/firmenkunden", "schema": "gold" },
    "metrics": "config/beispiele/firmenkunden.json" }
]
```

- `id` steht in der Adresse (`/?k=firmenkunden`): Kleinbuchstaben, Ziffern und `-`. `main` ist der erste Kosmos.
- `data` hat dieselben Felder wie oben. `data.name` ist der Name im Hauptmenü. Ohne `data.duckdb` gilt das DuckDB-Programm
  des ersten Kosmos.
- `metrics` ist die Kennzahlen-Datei dieses Kosmos. Leer heisst: noch keine. Wer in der App die erste hinzufügt, bekommt
  `config/kennzahlen-<id>.json`.
- Umgebungsvariablen wie `LUMANTIC_GOLD` oder `DATABRICKS_HOST` gelten nur für den ersten Kosmos. Das Windmill-Token
  teilen sich alle; die Tokens von Snowflake und Databricks hat jeder Kosmos für sich.
- Verschiedene Kosmen dürfen verschiedene Datenbanken haben, zum Beispiel einer über Parquet-Dateien und einer über Databricks.

In der App geht dasselbe im Hauptmenü mit «Kosmos hinzufügen». Die Seiten, die jemand in einem Kosmos baut, liegen pro
Kosmos im Arbeitsbereich (`data/board.json`).

## Eigenes Logo

```json
"brand": { "name": "Musterbank", "logo": "musterbank.svg", "logoDark": "musterbank-dunkel.svg", "designs": [] }
```

`logo` ist eine Datei in `config/brand/` (`.svg`, `.png` oder `.jpg`). Sie steht oben links an der Stelle des
Lumantic-Logos, etwa 26 Pixel hoch. `logoDark` ist dieselbe Marke für die dunklen Designs (Nacht, Dämmerung); fehlt sie,
gilt `logo` überall. Ist ein eigenes Logo gesetzt, steht oben rechts klein «powered by lumantic». Ohne `logo` bleibt das
Lumantic-Logo, und `name` steht daneben.

## Firmendesign

Ein Firmendesign baut auf einem eingebauten Design auf (`nacht`, `kreide`, `nebel`, `stein`, `daemmerung`) und
überschreibt nur die Farben, die es nennt:

```json
{ "id": "musterbank", "name": "Musterbank", "base": "kreide",
  "colors": { "bg": "#ffffff", "ink": "#0b1f3a", "accent": "#00539f" },
  "fonts": { "text": "Source Sans 3", "ui": "Source Sans 3", "mono": "IBM Plex Mono" },
  "fontFiles": [ { "family": "Hausschrift", "file": "fonts/hausschrift-400.woff2", "weight": "400", "style": "normal" } ] }
```

- Farben: `bg bg2 sheet sheetLine ink ink2 dim calm line line2 grid accent accentInk accentSoft alert watch good c1 c2 c3 chip menu`,
  jeweils als `#rrggbb`, `rgb(…)`, `rgba(…)` oder `transparent`. Unbekannte Namen werden ignoriert.
- Der Akzent sollte sich klar von den Statusfarben unterscheiden (Rot heisst in Lumantic «Alarm»).
- Eigene Schriften und das Logo liegen in `config/brand/` und werden unter `/brand/…` ausgeliefert
  (erlaubt: `.woff2 .woff .ttf .otf .svg .png .jpg`).
