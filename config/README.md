# Einstellungen von Lumantic

Lumantic liest seine Einstellungen aus `config/lumantic.json`. Die Datei entsteht, sobald jemand in der App unter
«Einstellungen» etwas speichert. Bis dahin gelten die Standardwerte. Eine vollständige Vorlage mit allen Feldern und einem
Firmendesign liegt in `lumantic.example.json`. Kopieren, umbenennen und anpassen genügt.

| Abschnitt | Wofür |
|---|---|
| `data` | Woher die Zahlen kommen: `duckdb` (eine DuckDB-Datei), `files` (ein Ordner mit Parquet- oder CSV-Dateien, jede Datei wird eine Tabelle `<schema>.<dateiname>`; ein Unterordner mit Parquet-Dateien ebenfalls), `snowflake`, `databricks` (siehe unten) oder `windmill` (zwei Skripte im Windmill-Workspace, Vorlagen in `adapters/windmill/`). |
| `metrics` | Datei mit den Kennzahlen (Ziel, Limit, Richtung, Tabelle, Spalte) und Lumantics Teil des Katalogs. Leer heisst: die eingebauten ALCO-Kennzahlen. Wer in der App eine Kennzahl ändert oder hinzufügt, bekommt `config/kennzahlen.json`. |
| `kosmen` | Weitere Kosmen neben dem ersten (siehe unten). `data` und `metrics` oben sind der erste Kosmos. |
| `refresh` | Wann der erste Kosmos von selbst neu gelesen wird (siehe «Aktualisierung»). Fehlt es, gilt das Übliche für seine Datenquelle. |
| `auth` | Wie man sich anmeldet und wer Administrator ist (siehe «Anmeldung und Rechte»). Nur in dieser Datei, nie aus der App. |
| `access`, `editors`, `rights` | Wer den ersten Kosmos sieht, wer seine Kennzahlen pflegt, und ob die Datenbank selbst prüft. |
| `ai` | Lumina mit Claude: an oder aus, Modell, und optional eine Adresse für ein Firmen-Gateway. |
| `ui` | Die Standard-Darstellung für alle. Jede Person kann sie in der App für sich ändern. `ui.language` ist die Sprache: `de`, `en` oder leer für die des Browsers. |
| `brand` | Firmenname, eigenes Logo und eigene Designs (siehe unten). |

## Tokens

Tokens stehen nie in dieser Datei, sondern in `data/secrets.json` (wird von der App geschrieben, nur für den eigenen
Benutzer lesbar). Die App zeigt von einem Token nur die letzten vier Zeichen.

Die Tokens von Snowflake und Databricks gehören zu einem Kosmos. Für den ersten heissen sie `snowflakeToken`,
`databricksToken` und `databricksSecret`, für jeden weiteren `snowflakeToken@<id>` und so fort. Wird ein Kosmos
entfernt, gehen seine Tokens mit. Den Claude-Token und den Windmill-Token teilen sich alle Kosmen.

## Datenort

Wo Lumantic seine Einstellungen (`lumantic.json`), Tokens (`secrets.json`), Arbeitsstände
(`board.json`), das Zugriffsprotokoll und die Beispiele ablegt:

1. Mit `LUMANTIC_CONFIG`, oder in einem Ordner mit `config/lumantic.json` (ein Quellcode-Ordner):
   alles relativ zum Arbeitsordner wie bisher, `config/` und `data/`.
2. Sonst in `LUMANTIC_HOME` (im Docker-Image `/data`),
3. sonst im Ordner für Einstellungen des Benutzers: `%AppData%\Lumantic` unter Windows,
   `~/Library/Application Support/Lumantic` unter macOS, `~/.config/lumantic` unter Linux.

Im eigenen Ordner liegt alles nebeneinander, und Pfade in den Einstellungen gelten von dort aus.
Gibt es noch keine Einstellungen und nennt keine Umgebungsvariable eine Datenquelle, startet
Lumantic mit den Beispielen Industrie und ALCO im Unterordner `beispiele/`. Lumantic schreibt sie
jeden Tag neu, damit sie im letzten Monat enden; Änderungen an ihnen gehen dabei verloren. Bekommt
ein Beispiel-Kosmos eine eigene Datenquelle, ist er kein Beispiel mehr; die übrigen entfernt man
unter Einstellungen › Kosmen.

## Umgebungsvariablen

Eine Umgebungsvariable gewinnt immer gegen die Datei. Die App zeigt solche Felder als «durch Umgebungsvariable gesetzt» an.

| Variable | Feld |
|---|---|
| `LUMANTIC_HOME` | Ordner für Einstellungen und Daten (siehe «Datenort») |
| `LUMANTIC_CONFIG` | Pfad dieser Datei (Standard `config/lumantic.json` oder `lumantic.json` im Datenort) |
| `LUMANTIC_SECRETS` | Pfad der Token-Datei (Standard `data/secrets.json`) |
| `LUMANTIC_ADAPTER`, `LUMANTIC_GOLD`, `LUMANTIC_SCHEMA`, `LUMANTIC_SOURCE`, `LUMANTIC_DUCKDB` | `data.type`, `data.path`, `data.schema`, `data.name`, `data.duckdb` |
| `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_ROLE`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_PRIVATE_KEY_FILE`, `SNOWFLAKE_TOKEN` | `data.snowflake.*` und der Snowflake-Token |
| `DATABRICKS_HOST`, `DATABRICKS_WAREHOUSE_ID`, `DATABRICKS_CATALOG`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_TOKEN` | `data.databricks.*`, das Secret des Service Principal und das persönliche Token |
| `WINDMILL_URL`, `WINDMILL_WORKSPACE`, `WINDMILL_DESCRIBE`, `WINDMILL_QUERY`, `WINDMILL_TOKEN` | `data.windmill.*` und der Windmill-Token |
| `LUMANTIC_METRICS` | `metrics` |
| `LUMANTIC_REFRESH_TOKEN` | der Aktualisierungs-Token des ersten Kosmos, im Klartext (sonst in der App erzeugen) |
| `LUMANTIC_AUTH`, `LUMANTIC_ADMINS` | `auth.kind` und `auth.admins` (Gruppen mit Komma getrennt) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `LUMANTIC_URL` | `auth.oidc.issuer`, `auth.oidc.clientId`, das Client-Secret und `auth.oidc.url` |
| `LUMANTIC_ACCESS_LOG` | Datei des Zugriffsprotokolls (Standard `data/zugriff.log`) |
| `LUMANTIC_OPEN` | Lumantic ohne Anmeldung mit eigenen Daten von aussen erreichbar machen, nur hinter einer eigenen Absicherung. Ohne zeigt es von aussen nur die Beispiele |
| `LUMANTIC_BROWSER` | `0`: beim Start den Browser nicht öffnen (er öffnet sich nur im eigenen Datenort und auf diesem Rechner) |
| `LUMANTIC_DUCKDB_MEMORY` | wie viel Speicher eine Abfrage in DuckDB brauchen darf (Standard `2GB`, höchstens vier laufen gleichzeitig) |
| `LUMANTIC_LUMINA` (`claude` oder `beispiel`), `LUMANTIC_MODEL`, `ANTHROPIC_BASE_URL` | `ai.enabled`, `ai.model`, `ai.baseURL` |
| `ANTHROPIC_API_KEY` oder `ANTHROPIC_AUTH_TOKEN` | der Claude-Token |
| `LUMANTIC_ADDR`, `LUMANTIC_DATA` | Adresse des Servers (Standard `127.0.0.1:8080`; ist der Port belegt, nimmt Lumantic einen freien), Datei mit dem Arbeitsbereich |

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

## Raster

```json
"grain": "quartal"
```

- Das Standardraster eines Kosmos: `monat` (Standard), `quartal` oder `jahr`. Darin urteilen «Heute» und das Hauptmenü.
  Lesen kann jede Person die Seiten in jedem Raster (Wahl neben dem Datum, Taste `G`); das merkt sich ihr Arbeitsbereich.
- Weitere Kosmen haben `grain` in ihrem Eintrag unter `kosmen`. In der App: Daten › Raster.
- Wie eine Kennzahl zu einem Quartal zusammenkommt, sagt ihr `kind` in der Kennzahlen-Datei: `stock`, `flow`, `avg` oder
  `ratio`. Ein Verhältnis braucht `parts` mit `mode: "ratio"` und sagt mit `parts.kind` (`stock` oder `flow`), wie Zähler
  und Nenner zusammenkommen. Im Fachkatalog heissen die Arten Bestand, Fluss, Durchschnitt und Verhältnis; ein Verhältnis
  ohne Zähler und Nenner mittelt Lumantic, bis sie da sind, und sagt das im Sternkatalog.
- Woche und Tag gibt es für Kennzahlen mit `daily`. Wochen nach ISO 8601, ab Montag. Als Standardraster eines Kosmos
  gehen sie nicht, denn der Status braucht alle Kennzahlen.
- Ziele von Flüssen: Ein Ziel mit Gültigkeit (`bounds`, im Fachkatalog `lumantic_ziele`) ist ein Jahresbudget, ausser
  es sagt `per: "monat"` (Spalte `periode`: «Monat»). Ein einzelnes `target` gilt pro Monat, mit `targetPer: "jahr"`
  pro Jahr. Verteilt wird nach `phasing`: `monate` (Standard: ein Zwölftel pro Monat, im Monat auf die Arbeitstage),
  `arbeitstage`, `kalendertage` oder `profil` mit `profile` (zwölf Gewichte). `phasing` steht pro Kennzahl, unter
  `extra` für Kennzahlen des Fachkatalogs, oder ganz oben in der Kennzahlen-Datei für alle.

## Anmeldung und Rechte

Ohne `auth` meldet sich niemand an: Alle sind «Lokal» und dürfen alles, und Lumantic hört dann nur auf diesem Rechner.
Ist `LUMANTIC_ADDR` von aussen erreichbar, startet Lumantic ohne Anmeldung nur mit den Beispielen
(so im Docker-Image ohne Einstellungen) und lehnt dann eigene Datenquellen, Tokens und weitere
Kosmen ab.

**Über einen Proxy** (zum Beispiel einen Authentik-Outpost vor Lumantic), der anmeldet und weitergibt, wer jemand ist:

```json
"auth": { "kind": "proxy", "admins": ["GG-Lumantic-Admin"],
          "proxy": { "trust": ["10.1.2.3"] } }
```

Lumantic liest Konto, Name und Gruppen aus `X-authentik-username`, `X-authentik-name` und `X-authentik-groups`
(Gruppen mit `|` getrennt). Andere Kopfzeilen stellt man unter `proxy` ein (`user`, `name`, `email`, `groups`, `sep`).
Die Kopfzeilen zählen nur, wenn die Anfrage von einer Adresse unter `trust` kommt (Standard: dieser Rechner).
«Abmelden» führt zu `/outpost.goauthentik.io/sign_out` oder zu `proxy.logout`.

**Mit OpenID Connect** (Authentik, Entra ID, Keycloak, ADFS):

```json
"auth": { "kind": "oidc", "admins": ["GG-Lumantic-Admin"],
          "oidc": { "issuer": "https://authentik.bank.ch/application/o/lumantic/", "clientId": "lumantic",
                    "url": "https://lumantic.bank.ch" } }
```

- Beim Anbieter legt man Lumantic als Anwendung an, mit der Rücksprungadresse `<url>/auth/callback`. Das Client-Secret
  kommt in `OIDC_CLIENT_SECRET` oder in `data/secrets.json` als `oidcSecret`.
- Die Gruppen stehen im Token unter `groups` (bei Authentik im Bereich `profile` enthalten), das Konto unter
  `preferred_username`; beides lässt sich unter `oidc.groups` und `oidc.user` umstellen. Bei Entra ID sind die Gruppen
  Objekt-IDs; dann stehen diese IDs in der Konfiguration.
- `scopes` ist standardmässig `openid profile email offline_access`; `offline_access` erlaubt, eine Anmeldung zu
  verlängern, ohne erneut zu fragen. Eine Sitzung dauert 8 Stunden.
- Die Windows-Anmeldung übernimmt der Anbieter: Authentik kann Kerberos mit dem Active Directory, Entra ID tut es mit
  Windows ohnehin.
- Lumantic prüft die Signatur des Tokens und nimmt nur RS256 und ES256 an. Worauf es bei den Anbietern ankommt:
  - **Authentik:** Der Provider braucht einen Signierschlüssel (sonst signiert Authentik mit HS256), und «Include claims
    in id_token» muss an sein. Für das Verlängern braucht es die Zuordnung für `offline_access`.
  - **Entra ID:** `issuer` ist mandantenbezogen, `https://login.microsoftonline.com/<tenant>/v2.0`. Statt Gruppen-IDs
    lieber App-Rollen nehmen (`"groups": "roles"`); bei sehr vielen Gruppen lässt Entra den Eintrag `groups` weg.
  - **Keycloak:** ein Gruppen-Mapper ohne «Full group path», sonst heissen Gruppen `/Finanz`.
  - **ADFS:** `user` auf `upn` stellen; Gruppen brauchen eine Transformationsregel.
- Sitzungen liegen im Speicher: Ein Neustart meldet alle ab, sie melden sich ohne Eingabe wieder an. Mehrere Instanzen
  brauchen dann feste Zuordnung (sticky sessions). In Betrieb `url` setzen, statt die Adresse aus der Anfrage zu nehmen.

**Rechte**

| Wo | Was | Leer heisst |
|---|---|---|
| `auth.admins` | Gruppen, die Datenquellen, Lumina, Kosmen und Aktualisierungs-Tokens ändern und alle Kosmen sehen | alle Angemeldeten |
| `access` (oben für den ersten Kosmos, sonst im Eintrag unter `kosmen`) | Gruppen, die den Kosmos sehen; die anderen sehen ihn auch im Hauptmenü nicht | alle Angemeldeten |
| `editors` | Gruppen, die seine Kennzahlen pflegen (Ziele, Grenzen, neue Kennzahlen) | nur Administratoren |
| `access` in einer Kennzahl (Kennzahlen-Datei) | Gruppen, die diese eine Kennzahl sehen | alle, die den Kosmos sehen |
| `rights: "source"` | Lumantic fragt Snowflake oder Databricks im Namen der Person; deren eigene Rechte gelten | Lumantic prüft die Gruppen |

Gruppen werden ohne Rücksicht auf Gross- und Kleinschreibung verglichen. Wer welche Kennzahl sieht, ändern nur
Administratoren. Sobald sich Leute anmelden, hat jede Person in jedem Kosmos ihre eigenen Seiten; sie beginnen mit den
Seiten, die vorher alle teilten.

**Im Namen der Person fragen** (`rights: "source"`, nur mit OpenID Connect): Das technische Konto des Kosmos liest nur
noch die Struktur. Die Zahlen liest Lumantic mit der Anmeldung der Person, wenn sie den Kosmos öffnet, und behält sie bis
zum nächsten Neulesen.
- Snowflake bekommt das Token der Anmeldung als OAuth-Token. Dafür braucht es in Snowflake eine External-OAuth-Integration,
  die dem Anbieter vertraut; es gilt die Rolle der Person.
- Databricks tauscht das Token der Anmeldung gegen ein eigenes (Token-Federation). Dafür braucht es im Databricks-Konto
  eine Federation-Policy für den Anbieter; es gelten die Rechte der Person im Unity Catalog, mit Zeilenfiltern und Masken.
- Beides ist gegen nachgebaute Antworten getestet, nicht gegen echte Konten.

**Zugriffsprotokoll:** Mit Anmeldung schreibt Lumantic in `data/zugriff.log`, wer sich wann an- und abmeldet und welchen
Kosmos öffnet, eine JSON-Zeile pro Ereignis, ohne Zahlen. Wie lange es bleibt, bestimmt ihr.

## Katalog

Ein Fachkatalog im Goldlayer besteht aus bis zu drei Tabellen oder Views mit festen Namen, in einem Schema, das die
Datenquelle zeigt (bei einem Ordner sind es Dateien `lumantic_kennzahlen.csv` und so fort). Nur die erste ist Pflicht;
fehlende Spalten bleiben offen. Wie euer Katalog intern aussieht, spielt keine Rolle: Die Views bilden ihn auf diese
Spalten ab.

| Tabelle | Spalten |
|---|---|
| `lumantic_kennzahlen` | `id`, `name`, `definition`, `thema`, `einheit` (z. B. «Mio. CHF», «%», «Stück», «Tage»), `art` («Bestand» oder «Fluss»), `richtung` («höher ist besser», «tiefer ist besser», «neutral»), `tabelle`, `wert_spalte`, `zeit_spalte`, `teile_spalte`, `eigner`, `berechnung`; für die englische Oberfläche `name_en`, `definition_en`, `thema_en`, `berechnung_en` |
| `lumantic_ziele` | `kennzahl_id`, `art` («Ziel» oder «Grenze»), `wert`, `name`, `gueltig_ab`, `gueltig_bis`, `periode` («Jahr» oder «Monat», optional); für die englische Oberfläche `name_en` |
| `lumantic_begriffe` | `begriff`, `definition`, `synonyme` (mit `;` getrennt), `kennzahl_id`; dazu `begriff_en`, `definition_en` |

- Jede Zeile von `lumantic_kennzahlen` ist eine Kennzahl, jedes `thema` eine Seite. Mit dem Fachkatalog allein baut
  sich ein Kosmos, ohne Kennzahlen-Datei.
- Was der Fachkatalog offen lässt, ergänzt Lumantic in der Kennzahlen-Datei des Kosmos unter `extra`, eine Kennzahl pro
  `id` (`desc`, `formula`, `owner`, `unit`, `kind`, `dir`, `target`, `limit`, `targetName`, `limitName`, und unter
  `en` die englischen Wörter `desc`, `formula`, `targetName`, `limitName`). Was der
  Fachkatalog füllt, gilt; Lumantic weist Änderungen daran ab.
- Lumantics eigene Begriffe stehen unter `terms`, eigene Kennzahlen wie bisher unter `kpis`.
- Was weder dort noch hier steht, vermutet Lumantic aus dem Spaltennamen und zeigt es als vermutet.
- Zeilen, die sich nicht lesen lassen, zeigt der Sternkatalog oben als Hinweis; die übrigen gelten.
- `GET /api/katalog/export?format=sql` (im Sternkatalog unter «Tabellen») schreibt den ganzen Katalog als SQL, das die
  drei Views im Schema `lumantic` anlegt, in der SQL-Sprache der Datenquelle.

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
