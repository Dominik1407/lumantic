# Lumantic

**Quiet until it matters.**

Lumantic is a calm surface over a team's gold layer. Pages made of blocks lie in a room: up
close you read them like a letter, from afar they fold into constellations. Lumina, the
assistant, writes «Today» and one page per topic and gives a reason for every choice.
Everything else you build yourself, and it stays saved.

The name: **Lum**en (light) + Se**mantic** (meaning). Bringing meaning to light.

```
Bronze    →  raw data
Silver    →  cleaned
Gold      →  finished key figures per team
Lumantic  →  the meaning, for everyone
```

[Deutsch](README.de.md)

## Quick start

**Download.** Get the file for your system from the
[releases](https://github.com/Dominik1407/lumantic/releases) (Windows, macOS, Linux), unpack
it and start `lumantic`; on Windows, double-click `lumantic.exe`. Your browser opens with two
example Kosmen, Industry and ALCO, whose figures run up to last month. Nothing to install:
DuckDB is built in. Connect your own gold layer, such as a folder of Parquet or CSV files,
under **Settings › Data** (it replaces the example) or with «Add a Kosmos» in the main menu.

The files are not signed yet. Windows SmartScreen warns on the first start: «More info», then
«Run anyway». macOS blocks the file: right-click › Open in the Finder, or run
`xattr -d com.apple.quarantine lumantic` in the Terminal.

**With Docker.**

```sh
docker run -p 127.0.0.1:8080:8080 -v lumantic-data:/data ghcr.io/dominik1407/lumantic
```

Without a login the image shows only the examples. **Next to the lakehouse**,
[docker-compose.yml](docker-compose.yml) mounts the gold layer as a folder, read-only, keeps
Lumantic's data in a volume and has the login as a template: `docker compose up -d`.

Where Lumantic keeps settings, tokens and work is described in
[config/README.md](config/README.md) under «Datenort». Data source, key figures, AI and design
are set in the app under **Settings** (the gear at the end of the bar at the bottom, or the
key `,`).

### From source

You need Go 1.25+ and Node 20+. With a C compiler (gcc or clang; on Windows MinGW-w64 with
gcc 15, the gcc 16 of MSYS2 does not fit DuckDB's library) Go builds DuckDB in; without one,
Lumantic asks the DuckDB CLI (`winget install DuckDB.cli`).

```powershell
.\scripts\run.ps1          # builds everything and starts on http://127.0.0.1:8080
.\scripts\run.ps1 -Seed    # writes the example gold layers anew
```

In a folder with `config/lumantic.json` (or with `LUMANTIC_CONFIG`) all paths stay relative to
the working folder, as suits development.

To work on the interface with live reload:

```powershell
go run ./cmd/lumantic        # API on :8080
cd web; npm run dev          # interface on :5173, passes /api and /brand on to :8080
```

## The app

**A page is a constellation seen up close, a constellation is a page seen from afar, and every
star is a block.**

- **Today** in the middle: what needs you this month, in sentences, with the evidence to unfold.
- **One page per topic** (liquidity, capital, …), built from the key figure definitions.
- **Build:** grab a block's star and drag it onto another page or into empty space. At the end
  of a page, `/` brings a block, `[[` a live key figure into a note.
- **Ask:** type a question with a question mark into the line at the end of a page. With AI,
  Lumina answers in an answer block and adds fitting charts. Without AI she finds key figure
  and view by keywords.
- **Time:** the room has a month. The time lens at the bottom right shows another month block
  by block; a block can hold on to a month.
- **Read and zoom:** over a long page the mouse wheel scrolls it like text; beside the page it
  zooms in and out. Dragging moves the room.
- **Keys:** at the bottom left, next to «Idea», «Keys» (or `?`) shows every shortcut. A key you
  press lights up there.

### Several Kosmen: the main menu

A **Kosmos** is a room over one data source, with its own key figures and its own pages.
Whoever sees more than one gold layer gets a Kosmos for each, and Lumantic opens in the
**main menu**: every Kosmos as a small sky, one star per key figure, below it the sentence
Lumina writes about «Today» in that Kosmos («Two things need you.»). A click or the keys `1` to
`9` fly in. The logo at the top left or the key `K` lead back.

Add a Kosmos in the main menu («Add a Kosmos»): name, data source, «Test the connection»,
«Create the Kosmos». Its key figures are set afterwards in its settings under «Data». With only
one Kosmos there is no main menu; the app opens straight into it. Addresses: `/?k=<id>` is a
Kosmos, `/?kosmen` the main menu.

For development, `.\scripts\run.ps1 -Seed` writes «ALCO» and three more example gold layers as
folders of CSV files: «Firmenkunden», «Privatkunden» and «Industrie», the controlling of an
invented maker of drives and controls (revenue, order intake, EBIT margin, OEE, delivery
reliability, good parts, scrap, days of inventory). `go run ./cmd/seed -folders` writes only the
folders, without rebuilding the DuckDB file. Their key figures are in `config/beispiele/`;
[config/lumantic.example.json](config/lumantic.example.json) connects all four.

Who sees which Kosmos is a matter of the login (see «Login and rights»).

### Keys

| Key | |
|---|---|
| `H` | Today |
| `K` | back to the main menu (with several Kosmen) |
| `C` | star catalogue: in the room this Kosmos's, in the main menu that of all Kosmen |
| `1` to `9` | open a topic page; in the main menu a Kosmos |
| `0` | overview of all pages |
| `←` `→` | one period back or forward (month, quarter or year), with `Shift` a year |
| `G` | change the raster: day, week, month, quarter, year |
| `Z` | switch between now and the last month looked at in the past |
| `Space` | play or pause the story |
| `/` | insert a block |
| `↑` `↓` | read on |
| `Tab` | take Lumina's suggestion |
| `Del` | remove the chosen block |
| `,` | settings |
| `?` | all keys at a glance |
| `I` | the idea and its sources |
| `Esc` | close what is open |

### Settings

| Tab | What you set there | For |
|---|---|---|
| **Look** | language, design, font, accent, motion, text size; «Save for everyone» makes the choice the default | you (or everyone) |
| **Start** | the view on opening, where the time lens looks, hints for gestures | you |
| **Data** | for the Kosmos you are in: connect and test the data source, reload; add key figures, change target, limit and direction; remove the Kosmos | everyone |
| **Kosmen** | in the main menu in place of «Data»: all Kosmen, add one, remove one | everyone |
| **Lumina** | AI on or off, model, API token, optionally the address of a company gateway, test the connection | everyone |
| **About** | version, Kosmos, path of the configuration, reset your own pages | |

What is personal lies in the workspace on the server, what holds for everyone in the
configuration (`lumantic.json`). The room rebuilds itself after changes to data or key figures
when the settings close.

### Language

Lumantic speaks German and English. Under Look › Language everyone chooses «As the browser»,
Deutsch or English; «Save for everyone» makes it the team's default (`ui.language`: `de`, `en`
or empty). English reads numbers the international way (`CHF 92m`, `CHF 1.2bn`, `1,150.5`,
`12.5%`, `Oct 2026`), German stays Swiss (`92 Mio. CHF`, `1’150.5`).

Lumantic translates only its own texts: the room, Lumina's sentences, the main menu, the
settings, the star catalogue and the server's messages. Lumina answers in the language of the
interface. What a team defines stays as it is; English words stand beside it under `en` (see
«Defining key figures»), in the company catalogue in columns ending in `_en`. Where an English
word is missing, the German one shows. Whoever changes a definition in the star catalogue in
English changes its English words; the German ones stay.

### Designs

Five designs are built in: **Night** (the original night sky), **Chalk**, **Mist** (the
default), **Stone** and **Dusk**. Every colour of the interface, in charts and on the canvas as
well, is a token of the design ([web/src/styles/themes.css](web/src/styles/themes.css)).

A **corporate design** goes into the configuration under `brand`: a built-in design as its
base, plus only the colours and fonts that differ. Logo and house font go into
`config/brand/`. The template «Musterbank» is in
[config/lumantic.example.json](config/lumantic.example.json), the fields in
[config/README.md](config/README.md). The corporate design then appears in the design choice.

The fonts ship with the app. It needs no access to Google Fonts.

### Logo

The logo «Baustein» (two blocks and a lit star) and the wordmark live in one single place in the
code, [web/src/logo.ts](web/src/logo.ts). The icon in the browser tab comes from there too.

A company sets its **own logo** in the configuration: `brand.logo` (and optionally
`brand.logoDark` for the dark designs) names a file in `config/brand/`. It then stands at the
top left in place of the Lumantic logo, in the main menu and in every Kosmos, and «powered by
lumantic» appears small at the top right. An example is included: `config/brand/musterbank.svg`.

## Lumina, the rules behind it

Every key figure is rated per month, quarter and year:

| Level | When |
|---|---|
| Limit breached | below the regulatory minimum (or above the limit) |
| Below internal target | target missed by more than 3% |
| Narrowly missed | target missed, but within 3% |
| Persistent trend | six moves in a row in the wrong direction (a rule of statistical process control) |
| Unusual move | more than 2 standard deviations and at least 5% from the usual of the last 8 periods, in the wrong direction |
| Good news | just as unusual, but in the good direction |
| Recovering, still close | back on target after an alert, but without a 2% safety margin yet (hysteresis) |

For every page Lumina makes all sensible views (trend against limits, composition, bridge,
numerator and denominator, cumulative, comparison, days), rates them by urgency and
expressiveness and suggests the best one next. What you change stays; new recommendations
appear only as a suggestion («This fits», `Tab`).

The reasons for these decisions are in [design/README.md](design/README.md) (German).

## Defining key figures

What a key figure is, where it lives and which bounds hold is written in a JSON file. The
numbers themselves stay in the gold layer. The default is
[internal/metrics/default.json](internal/metrics/default.json) with the ALCO key figures.
Whoever adds or changes a key figure in the settings under «Data» gets a file of their own,
`kennzahlen.json` beside the configuration. It can also be kept by hand, or `LUMANTIC_METRICS`
points to another file.

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

- `kind`: how the key figure adds up over a quarter or a year: `stock` (balance at the end of
  the period), `flow` (sum), `avg` (average of the months, such as the interest margin) or
  `ratio` (numerator and denominator added up each on their own, then divided; needs `parts`
  with `mode: "ratio"`).
- `dir`: `1` more is better, `-1` less is better, `0` neutral.
- `limit` is the regulatory bound, `target` the internal target (with `dir: -1` the early warning).
- `parts` splits a key figure: into columns (`columns`) or by a dimension (`split`, e.g.
  `segment`). `mode` is `sum`, `ratio` or `funnel`. With `ratio`, `kind` says how numerator and
  denominator add up: `stock` (at the reporting date, as for the LCR) or `flow` (summed, as for
  the scrap rate: scrap ÷ parts made).
- `daily` is optional: a table with one row per day (or per day and part). It feeds the daily
  values and makes the key figure readable in weeks and days as well. Percentages need one row
  per day, as Lumantic sums the rows of a day.

At the start Lumantic checks every table and column against the catalogue. If a key figure lacks
a column, only that figure drops out; the settings show what is missing.

Units (`unit`): `%`, money in millions of CHF (`Mio`, shown as billions with `Mrd`, `Tsd` for
thousands of CHF), `Stk` (pieces), `Tage` (days), `h` (hours) and `Zahl` (number). Further
fields serve the catalogue: `formula` (the calculation in words), `owner` (who answers for the
key figure) and `bounds`, targets and limits that hold for a time, such as a budget per year:

```json
"bounds": [ { "kind": "ziel", "value": 8.0, "name": "Budget 2025", "from": "2025-01", "until": "2025-12" },
            { "kind": "ziel", "value": 9.0, "name": "Budget 2026", "from": "2026-01" } ]
```

For a flow such a target is an **annual budget**, unless it says `"per": "monat"`. A single
`target` holds per month as before; with `"targetPer": "jahr"` it is an annual target. Lumantic
spreads an annual target by the industry standard: one twelfth per month, within the month
evenly over the working days Monday to Friday. This can be changed per key figure with
`phasing` (also in the star catalogue under «Spread»): `arbeitstage` (the year by its working
days), `kalendertage` (by all days) or `profil` with `"profile": [12 weights]`, for example
more at the end of a quarter. `phasing` at the top of the file holds for all.

English words go under `en`, for the English interface: for a key figure `name`, `long`,
`short`, `desc`, `targetName` and `limitName`, for a group `name`, for an event `title` and
`text`, at the top `title` and `source`, for a term `term` and `definition`, in `extra` also
`formula`.

```json
"en": { "name": "Interest margin", "short": "NIM", "desc": "Net interest income relative to interest-earning assets, annualised." }
```

## Rasters: day, week, month, quarter, year

Beside the date on «Today» stands the choice of raster: **day**, **week**, **month**,
**quarter** or **year** (key `G`). In quarters every page shows the quarter, the sentences
compare with the previous quarter, the charts label their axis in quarters, and `←` `→` move by
a quarter. Quarters and years come from the months, by the kind of key figure: a balance counts
with its last month, a flow is summed, an average averaged, a ratio computed from numerator and
denominator. Percentages are never averaged when their parts are known.

A running quarter is called «Q4 2026 through October». A flow in it is compared with the same
months of the previous year and with the target so far, not with the whole.

**Week and day** exist as soon as a key figure has a daily table (`daily`). Weeks count by
ISO 8601 from Monday and come only from days, never from months: «Week 46 2026». A running week is
called «Week 46 2026 through Tuesday» and compared with the same days of the previous week. A day
without a row is empty, never zero. The weekly or daily target of a flow is the sum of its days
(see annual budget above). A key figure without daily values stays with its month in weeks and
days and says «monthly only». The server sends the days of the last 90 days and the
weeks of the last two years.

The status has a fixed raster: «Today» and the main menu judge in the Kosmos's **standard
raster** (Settings → Data → Raster, month by default), so a key figure does not jump from calm
to red when you switch. The topic pages judge in the raster you read in. The workspace remembers
the chosen raster.

## Catalogue: what the numbers mean

Every Kosmos has a **star catalogue** (key `C`, or «Catalogue» in the bar at the bottom): every
key figure as an entry with definition, calculation, source, unit, kind, direction, targets over
time and owner, plus the words of the house with synonyms and the tables beneath. In the main
menu it searches all Kosmen. Lumina gets the definitions and words and so understands
«Termintreue» as delivery reliability.

The meaning comes from three sources, field by field in this order, and every field shows where
it came from:

1. ● **Company catalogue in the source:** three tables or views with fixed names in the gold
   layer (`lumantic_kennzahlen`, `lumantic_ziele`, `lumantic_begriffe`). If they exist, a Kosmos
   builds itself from them, without a key figure file. What stands there is changed there.
2. ○ **Added in Lumantic:** own key figures in the key figure file, and what the company
   catalogue leaves open (`extra`, for example a target or a definition). This is added right in
   the star catalogue.
3. ◌ **Guessed:** unit and kind from the column name (`_pct` is percent, `_mio` millions of
   CHF, `_stk` pieces), always only a suggestion.

Lumantic never writes into the database. Whoever wants to take a catalogue begun in Lumantic
into the gold layer downloads it in the star catalogue under «Tables» as SQL: it creates the
three views, and from then on Lumantic reads the catalogue from the source. English words stand
in the company catalogue in the columns `name_en`, `definition_en`, `thema_en`, `berechnung_en`
and `begriff_en`, and a target or limit has its own `name_en`.
Contract and columns in detail: `config/README.md`, section «Katalog». The example Kosmos
«Industry» shows all three origins.

## Connecting a data source

Under **Settings › Data** you pick one of five kinds; «Test the connection» shows the tables found,
«Save» takes them. If the new source fails, the old one stays. This holds for the Kosmos you are
in; a further data source becomes a further Kosmos (see «Several Kosmen»). In a source folder
without settings, the very first start asks «Where does your gold layer live?» with the five
kinds as cards.

- **DuckDB file:** path to the file and schema prefix. Descriptions come from
  `COMMENT ON TABLE/COLUMN`. Lumantic opens it read-only for each query, so a loading job can
  write it in between.
- **Folder of Parquet or CSV files:** every file becomes the table `<schema>.<file name>`, every
  subfolder of Parquet files as well. DuckDB reads only inside this folder.
- **Snowflake:** account, user, warehouse, database, schema and optionally a role. Sign-in with
  a key pair (recommended) or a token. Lumantic uses the SQL API, no driver.
- **Databricks:** workspace address, SQL warehouse ID, catalog and schema. Sign-in as a service
  principal with OAuth (recommended) or with a personal token. Lumantic uses the SQL Statement
  Execution API.
- **Windmill:** create the two scripts from `adapters/windmill/` in Windmill, then enter address,
  workspace and token. The adapter calls
  `POST /api/w/{workspace}/jobs/run_wait_result/p/{path}`. Not yet tested against a real
  Windmill instance.

A table needs a date column (`DATE` or `TIMESTAMP`) for key figures from it to become time
series.

Every database gets its own SQL: Lumantic asks its questions as a structure (sums per month or
day, values of a dimension, rows per table), and one dialect per database writes them
(`internal/adapter/dialect.go`). Only what begins with `SELECT` or `WITH` and is a single
statement goes to Snowflake and Databricks. Fields and setup in detail: `config/README.md`.
Snowflake and Databricks are tested against rebuilt answers of their interfaces, not yet against
real accounts.

## Refresh

Lumantic always reads a Kosmos anew as a whole, never only the newest day; so corrections to old
days come along. Opening a page never asks the database: the figures come from memory. A Kosmos
is read again:

- **on a nudge:** the last step of the loading job calls `POST /api/refresh?k=<kosmos>` with the
  Kosmos's refresh token (`Authorization: Bearer …`, or as the password of a basic sign-in, as
  many webhook tools offer). Lumantic answers `202` at once and reads in the background. If a
  nudge comes while it reads, it reads once more afterwards, never more often. Create the token
  in the settings under **Data › Refresh**; it is shown once, only a hash is stored. A template
  for Windmill is in `adapters/windmill/refresh.py`.
- **at fixed times**, for example daily at 06:00. That is the default for Snowflake, Databricks
  and Windmill: the warehouse wakes once.
- **when files change:** for a DuckDB file or a folder, Lumantic looks at the number, size and
  time of the files every few minutes (default: every 5 minutes), without reading the data.
  There is no such thing for warehouses, as the question alone would wake the warehouse.
- **by hand** with «Read again».

`GET /api/refresh?k=<kosmos>` tells a loading job how the last run went and when the next one
comes. Open pages hear of every run through `GET /api/events` (server-sent events). If it
brought new figures, «New figures · as of 07:42» appears at the top with «Show»; a page in the
background takes them quietly and opens again where you were.

If a loading job's daily files lie in a subfolder, the folder is one table: every day comes in
as a file, and `union_by_name` copes when a column is added later. Folders of the form
`jahr=2026/monat=11/` are read by DuckDB as partitions.

## Login and rights

Without a login Lumantic is for one machine: everyone may do everything, and it listens only on
`127.0.0.1`. Reachable from outside without a login (as in a container), it shows only the
examples. For several people you sign in through a proxy in front (an Authentik outpost, for
example) or with OpenID Connect (Authentik, Entra ID, Keycloak, ADFS). The Windows sign-in is
handled by the provider. Lumantic has no users and no passwords of its own. It takes account,
name and groups from the sign-in:

- **Administrators** (`auth.admins`) change data sources, Lumina and Kosmen and see every Kosmos.
- **A Kosmos** shows itself only to the groups under `access`; the others do not see it in the
  main menu either.
- **Key figures** may be looked after by administrators and the groups under `editors`.
- **A key figure** can have groups of its own (`access` in the key figure file).
- **In the person's name:** with Snowflake and Databricks Lumantic can ask with the person's
  sign-in (`rights: "source"`); then the database's rights hold, including row filters and masks.

Everyone has their own pages, and `zugriff.log` records who signs in and opens which Kosmos.
Setup in detail: `config/README.md`, section «Anmeldung und Rechte».

## Lumina with Claude

Without an API token, Lumina searches questions by keywords. With a token (Settings → Lumina, or
`ANTHROPIC_API_KEY`) Claude answers the question in one to three sentences and suggests up to
three charts. The default model is `claude-opus-5-5`.

Lumina sends the question and the evaluated key figures of the month shown to Anthropic (value,
previous month, target, limit, level, the last 13 months, parts), no data rows from the gold
layer. The token lives in `secrets.json`, never in the configuration, and the app shows only its
last four characters. If access runs through a company gateway, enter its address. The rules,
sentences and recommendations on the pages run without AI.

## Architecture

```
             Browser (web/: the Kosmos room in JS, settings and designs in TypeScript)
                │  JSON API
   ┌────────────┴──────────────────────────────────────────┐
   │ Go server (one program, interface and DuckDB inside)   │
   │  config   settings, environment variables, tokens      │
   │  source   builds the data source from the settings     │
   │  metrics  definitions + gold layer → time series       │
   │  ai       Claude for Lumina                            │
   │  store    workspace: pages, blocks, look               │
   └────────────┬──────────────────────────────────────────┘
                │  two connectors: describe() and query()
        Adapters: duckdb · files (Parquet/CSV) · snowflake · databricks · windmill
                │
        The teams' gold layers
```

| Folder | Contents |
|---|---|
| `cmd/lumantic` | the server |
| `cmd/seed` | writes the example gold layers for development: «ALCO» and «Retail Banking» as a DuckDB file, «Firmenkunden», «Privatkunden» and «Industrie» as CSV folders (all figures invented) |
| `internal/beispiele` | the examples themselves: stories in numbers that always end last month; the first start writes Industry and ALCO |
| `config/beispiele/` | key figure definitions of the example Kosmen Industrie, Firmenkunden and Privatkunden |
| `config/` | template and description of the settings, corporate designs in `brand/` |
| `internal/config` | loading, checking and saving the settings; tokens |
| `internal/auth` | sign-in: none, through a proxy or with OpenID Connect |
| `internal/katalog` | reading the company catalogue, merging it with Lumantic's definitions and guesses, writing it as SQL |
| `internal/source`, `internal/adapter` | data source from the settings; DuckDB, folder and Windmill adapters, the SQL dialects; DuckDB built in (`duckdb_builtin.go`, with cgo) or as the CLI |
| `internal/adapter/snowflake`, `internal/adapter/databricks` | Snowflake through the SQL API, Databricks through the SQL Statement Execution API |
| `internal/metrics` | key figure definitions, checks against the catalogue, loading the time series, editing |
| `internal/ai`, `internal/lumina` | Claude for Lumina; question cards of the first interface |
| `internal/server` | HTTP API |
| `internal/i18n` | Lumantic's messages in English: the German formats with their translation, applied at the edge of the API |
| `web/src/kosmos/` | the room: numbered JS parts that `vite.config.ts` joins into one module |
| `web/src/menu.ts`, `logo.ts` | the main menu of the Kosmen; the logo, in one place |
| `web/src/settings.ts`, `themes.ts`, `prefs.ts`, `main.ts` | settings, designs, the saved choice, start |
| `web/src/i18n.ts` | the language of the interface; texts stand in place in both languages: `tr("Heute", "Today")` |
| `web/src/styles/` | `themes.css` (the designs), `kosmos.css`, `settings.css`, `app.css` |
| `design/` | drafts and reasons (German), earlier interfaces in `archive/` |
| `adapters/windmill` | templates for the Windmill scripts: structure, queries and the nudge after a flow |

### API

| | |
|---|---|
| `GET /api/metrics` | key figures with monthly, weekly and daily series, parts, events and the standard raster (503 without data) |
| `GET /api/workspace`, `PUT /api/workspace` | pages, blocks and the personal look |
| `GET /api/settings`, `PUT /api/settings` | settings for everyone (tokens never in plain text) |
| `POST /api/settings/data/test` | test a data source without saving |
| `PUT /api/settings/secret` | set or remove a token; those of Snowflake and Databricks belong to the Kosmos from `?k=` |
| `POST /api/refresh` | read a Kosmos anew: with a refresh token `202` at once and in the background, from the app waiting |
| `GET /api/refresh` | state of the last run, its duration, what started it and the next time |
| `POST`/`DELETE /api/refresh/token` | create a Kosmos's refresh token (shown once) or remove it |
| `GET /api/events` | messages to open pages when a Kosmos was read anew (server-sent events) |
| `GET /api/me` | who is signed in and what this person may change |
| `GET /api/katalog` | the star catalogue of a Kosmos: entries with the origin of each field, terms, tables |
| `PUT /api/katalog/kennzahl/{id}`, `PUT /api/katalog/begriffe` | add what the company catalogue leaves open; Lumantic's terms |
| `GET /api/katalog/export?format=sql` | the catalogue as SQL for the three views in the gold layer (or `json`) |
| `/auth/login`, `/auth/callback`, `/auth/logout` | sign-in with OpenID Connect; with a proxy only signing out |
| `POST /api/settings/ai/test` | a short request to Claude |
| `GET/POST /api/kpis`, `PUT/DELETE /api/kpis/{id}` | key figure definitions |
| `POST /api/lumina/ask` | a question to Lumina with the facts of the month |
| `GET /api/catalog` | the catalogue as Lumina sees it |
| `GET/POST /api/kosmen`, `DELETE /api/kosmen/{id}` | all Kosmen with their status; add one; remove one |
| `GET /brand/…` | logo and fonts from `config/brand/` |
| `GET /healthz` | whether Lumantic runs, without a login (for containers; `lumantic health` asks it) |

Everything that concerns a Kosmos (key figures, workspace, data source, catalogue) takes
`?k=<id>`; without it the first Kosmos is meant. Requests that change something must be JSON and
come from the same site. The API answers in English when `Accept-Language` begins with `en`, the
cookie `lumantic_lang=en` is set or `?lang=en` is given.

## Tests

```powershell
go test ./...
cd web; npm run build; cd ..
node scripts/ui-test/run.mjs     # the interface in real time: one Kosmos (desktop, phone, reduced motion), main menu with three, short window, rasters, English
```

The CI checks both ways of DuckDB, built in and as the CLI, on Linux and Windows. A tag `v*`
builds the files for five systems and the image, tries each once and publishes them
(`.github/workflows/release.yml`).

`run.mjs` starts a test server with fixed key figures (`scripts/ui-test/mock-api.mjs`), plays the
app in Edge without a window with real keys and clicks, and puts screenshots in
`scripts/ui-test/shots/`.

## Next steps

- Rights on single parts of a key figure (region East sees only East) and rights like Windows
  folder rights
- Suggesting the key figures of a new Kosmos from its tables
- Holidays when spreading targets over working days (per canton)
- A morning report as a message in Teams or by mail
- Testing Windmill, Snowflake and Databricks against real instances
- Correcting for multiple comparisons when Lumina checks very many series

## Contributing

Ideas and bugs are always welcome as issues. Pull requests please only after agreeing on them in
an issue; how that works and where help counts most is in [CONTRIBUTING.md](CONTRIBUTING.md).
Please report security holes privately, see [SECURITY.md](SECURITY.md).

## License

Lumantic is licensed under the [Apache License 2.0](LICENSE). Notes on the bundled fonts are in
[NOTICE](NOTICE); the licences of everything else inside the program come with every release as
`THIRD_PARTY_NOTICES.txt`.
