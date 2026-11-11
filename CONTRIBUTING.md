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
| Data source adapters | `internal/adapter/` | One file or package per source, behind the interface in `adapter.go`; SQL differences go into `dialect.go`. Existing: DuckDB, files, Windmill, Snowflake, Databricks. |
| Corporate designs | `config/brand/`, `brand` in `config/lumantic.example.json` | Templates that show how a company brings its own logo, fonts and colours. |
| Key figure templates | `config/beispiele/` | Ready-made key figures for a domain, such as retail banking or insurance. |
| Translations | `web/src/` | The interface is German today. Making it translatable is a welcome first step; please open an issue before starting. |

## What stays with the maintainer

The surface itself: the Kosmos, its motion, layout, colours and wording. Lumantic is meant to
be an invention, not another BI tool, and that only works with one hand on the design. Ideas
and critique are very welcome as issues; changes there come from the maintainer.

## Getting started

You need Go 1.25+, Node 20+ and the DuckDB CLI. On Windows, `.\scripts\run.ps1` builds and
starts everything. By hand:

```sh
go run ./cmd/seed -duckdb <path to duckdb>   # example gold layer in goldlayer/
go run ./cmd/lumantic                        # API on :8080
cd web && npm ci && npm run dev              # interface on :5173 with live reload
```

Without `config/lumantic.json`, Lumantic opens with its first-start welcome. The file is
created when you save settings in the app and is not part of the repository.

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
