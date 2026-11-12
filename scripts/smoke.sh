#!/usr/bin/env bash
# Tries a running Lumantic that started without settings: it must answer and
# show both examples ready. Used by the release pipeline for every program and
# image.
#
#   scripts/smoke.sh http://127.0.0.1:8099
set -euo pipefail
url=$1
for _ in $(seq 1 90); do
  curl -fs "$url/healthz" >/dev/null && break
  sleep 2
done
kosmen=$(curl -fs "$url/api/kosmen")
echo "$kosmen"
ready=$(grep -o '"ok":true' <<<"$kosmen" | wc -l)
[ "$ready" -ge 2 ] || { echo "the examples are not ready"; exit 1; }
