#!/usr/bin/env bash
# Writes the licences of everything the Lumantic program carries into one file:
# the Go modules it is built from, DuckDB with the third-party code inside it,
# and the fonts of the interface (in NOTICE). Run with CGO_ENABLED=1, so the
# DuckDB modules count. It downloads DuckDB's source once, for its notices;
# the CI and the image build run it, nobody needs to locally.
#
#   scripts/third-party.sh [out-file]    (default THIRD_PARTY_NOTICES.txt)
set -euo pipefail
out=${1:-THIRD_PARTY_NOTICES.txt}
cd "$(dirname "$0")/.."

{
  echo "Lumantic carries the following software. Its own licence is in LICENSE, the"
  echo "fonts of the interface are listed in NOTICE."
  echo
  # Every module the program is built from, with its licence files.
  go list -deps -f '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}} {{.Dir}}{{end}}{{end}}' ./cmd/lumantic | sort -u |
    while read -r path version dir; do
      echo "================================================================================"
      echo "$path $version"
      echo "================================================================================"
      found=0
      for f in "$dir"/LICENSE* "$dir"/LICENCE* "$dir"/COPYING* "$dir"/NOTICE*; do
        [ -f "$f" ] || continue
        cat "$f"
        echo
        found=1
      done
      [ "$found" = 1 ] || echo "(no licence file in the module)"
      echo
    done

  # DuckDB inside the bindings: its version is written in the module's, 0.10506.0 is DuckDB 1.5.6.
  v=$(go list -m -f '{{.Version}}' github.com/duckdb/duckdb-go-bindings)
  n=${v#v0.}; n=${n%%.*}
  duckdb="v${n:0:1}.$((10#${n:1:2})).$((10#${n:3:2}))"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "https://github.com/duckdb/duckdb/archive/refs/tags/$duckdb.tar.gz" | tar -xz -C "$tmp"
  src=$(echo "$tmp"/duckdb-*)
  echo "================================================================================"
  echo "DuckDB $duckdb: third-party code built into it"
  echo "================================================================================"
  find "$src/third_party" "$src/extension" -maxdepth 4 -type f \( -iname 'LICENSE*' -o -iname 'LICENCE*' -o -iname 'COPYING*' -o -iname 'NOTICE*' \) | sort |
    while read -r f; do
      echo "--- ${f#"$src"/}"
      cat "$f"
      echo
    done
} > "$out"
echo "wrote $out"
