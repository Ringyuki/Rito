#!/bin/bash
# Measures the acceptance rows — three books, phone and desktop — with
# accept.mjs and writes one JSON line per row to the file named as the
# first argument. Timings move by tens of milliseconds with whatever else
# the machine is doing, so each row starts only once the one-minute load
# average is below QUIET_LOAD (default 3), and the load it started at is
# printed beside it.
#
#   tools/reader-accept/accept-all.sh tools/reader-accept/after.jsonl
#   env CORPUS (default ~/rito-corpus), BOOKS (default "004 121 041"),
#       URL, RUNS (as accept.mjs), QUIET_LOAD
set -u
out=${1:?usage: accept-all.sh <out.jsonl>}
here=$(cd "$(dirname "$0")" && pwd)
corpus=${CORPUS:-$HOME/rito-corpus}
quiet=${QUIET_LOAD:-3}

load() {
  if [ -r /proc/loadavg ]; then cut -d' ' -f1 /proc/loadavg; else sysctl -n vm.loadavg | awk '{print $2}'; fi
}

: > "$out"
for name in ${BOOKS:-004 121 041}; do
  book=$(find "$corpus" -maxdepth 1 -name "$name*.epub" | head -1)
  if [ -z "$book" ]; then
    echo "no book named $name*.epub in $corpus" >&2
    exit 1
  fi
  for view in phone desktop; do
    until awk "BEGIN { exit !($(load) < $quiet) }"; do sleep 10; done
    echo "$name $view: starting at load $(load)" >&2
    (cd "$here" && BOOK="$book" VIEW=$view RUNS=${RUNS:-3} node accept.mjs) | tail -1 >> "$out"
  done
done
