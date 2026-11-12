#!/usr/bin/env bash
# Prints the DuckDB version built into Lumantic, read from the duckdb-go bindings
# in go.mod: v0.10506.0 is DuckDB v1.5.6.
set -euo pipefail
cd "$(dirname "$0")/.."
v=$(go list -m -f '{{.Version}}' github.com/duckdb/duckdb-go-bindings)
n=${v#v0.}
n=${n%%.*}
echo "v${n:0:1}.$((10#${n:1:2})).$((10#${n:3:2}))"
