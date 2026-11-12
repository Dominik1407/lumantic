# Contributing to Lumantic

Thanks for your interest. Lumantic is a small project with one maintainer and a clear idea of
how it should look and feel. Contributions are welcome, in a curated way:

- **Issues and ideas: always.** Bug reports, questions and proposals help the most.
- **Pull requests: after agreement.** Open an issue first and describe what you want to change.
  Once the direction is agreed, send the pull request and link the issue. Pull requests without
  a prior issue may be closed, however good they are.

## Where help is most welcome

| Area | Where | Notes |
|---|---|---|
| Data source adapters | `internal/adapter/` | One file or package per source, behind the interface in `adapter.go`; SQL differences go into `dialect.go`. Existing: DuckDB, files, Windmill (in `internal/adapter/`), Snowflake and Databricks (packages `internal/adapter/snowflake`, `internal/adapter/databricks`, which can also ask in a person's name). |
| Catalog readers | `internal/katalog/` | Today the company catalog is read from three views with fixed names. Readers for catalog tools (such as Unity Catalog tags or Snowflake semantic views) are welcome. |
| Corporate designs | `config/brand/`, `brand` in `config/lumantic.example.json` | Templates that show how a company brings its own logo, fonts and colours. |
| Key figure templates | `config/beispiele/` | Ready-made key figures for a domain, such as retail banking, industry or insurance. |
| Translations | `web/src/`, `internal/i18n/` | The interface speaks German and English: texts stand in place as `tr("Heute", "Today")`, the server's messages are in `internal/i18n/en.go`. Further languages: please open an issue before starting. |

## What stays with the maintainer

The surface itself: the Kosmos, its motion, layout, colours and wording. Lumantic is meant to
be an invention, not another BI tool, and that only works with one hand on the design. Ideas
and critique are very welcome as issues; changes there come from the maintainer.

## Getting started

You need Go 1.25+ and Node 20+. A C compiler is optional: with one (gcc or clang; on Windows
MinGW-w64 with gcc 15, as DuckDB's library does not link with gcc 16), Go builds DuckDB into
the program, as the releases do; without one,
`go run` and `go test` work as well and Lumantic asks the DuckDB CLI
(`winget install DuckDB.cli`, or `LUMANTIC_DUCKDB` with its path). The CI tests both. On
Windows, `.\scripts\run.ps1` builds and starts everything. By hand:

```sh
go run ./cmd/seed -duckdb <path to duckdb>   # example gold layers in goldlayer/
go run ./cmd/lumantic                        # API on :8080
cd web && npm ci && npm run dev              # interface on :5173 with live reload
```

In a folder with `config/lumantic.json`, or with `LUMANTIC_CONFIG`, paths stay relative to the
working folder. Without either, Lumantic keeps its data in your settings folder and starts with
the examples (see `config/README.md`, «Datenort»).

## Before you send a pull request

```sh
go test ./...
cd web && npm run build
node scripts/ui-test/run.mjs   # interface in real time, needs Microsoft Edge
```

- Match the code around you: `gofmt`, few comments, plain names. The Kosmos parts in
  `web/src/kosmos/` stay plain JavaScript.
- One topic per pull request. Add screenshots for anything visible.
- Never commit tokens, real figures or company logos. `data/` and `goldlayer/` are ignored for
  that reason.
- Commit messages in English or German, both are fine.

## Sign your commits (DCO)

Lumantic uses the [Developer Certificate of Origin](https://developercertificate.org) instead of
a contributor licence agreement. A `Signed-off-by` line confirms that you wrote the change or
have the right to submit it under the project's licence:

```sh
git commit -s -m "Add Postgres adapter"
```

Contributions are licensed under the [Apache License 2.0](LICENSE), like the rest of the project.

## Conduct and security

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues go
through [SECURITY.md](SECURITY.md), never through public issues.
