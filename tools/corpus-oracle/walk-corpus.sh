#!/bin/sh
# Walks every book in the corpus one at a time (walks must run solo),
# appends each book's verdict to a ledger, and drops the captures right
# after so the disk never holds more than one book's PNGs.
# Usage: walk-corpus.sh <corpus-dir> <ledger.tsv> [first-book-prefix]
cd "$(dirname "$0")" || exit 1
corpus="$1"; ledger="$2"; from="${3:-000}"
[ -f "$ledger" ] || printf 'book\tpages\tzero\tbeyond_floor_px\tbeyond_floor_pages\ttotal_px\tworst_px\n' > "$ledger"
for book in "$corpus"/*.epub; do
  name=$(basename "$book" .epub)
  prefix=$(printf '%s' "$name" | cut -c1-3)
  [ "$prefix" \< "$from" ] && continue
  grep -q "^$prefix	" "$ledger" && continue
  out="walk-corpus-$prefix"
  # A killed browser is system noise, not a verdict: retry with backoff,
  # and record a failure only when every attempt dies.
  attempt=1
  while :; do
    rm -rf "$out"
    if node pixel-walk.mjs "$book" "$out" > "$out.log" 2>&1 && [ -f "$out/report.md" ]; then
      break
    fi
    if [ "$attempt" -ge 3 ]; then
      break
    fi
    echo "RETRY $prefix attempt $attempt"
    sleep $((attempt * 30))
    attempt=$((attempt + 1))
  done
  if [ ! -f "$out/report.md" ]; then
    printf '%s\tFAILED\t\t\t\t\t\n' "$prefix" >> "$ledger"
    echo "FAILED $prefix"
    rm -rf "$out"
    continue
  fi
  report="$out/report.md"
  pages=$(sed -n 's/^pages compared: \([0-9]*\); at ZERO diff: \([0-9]*\); worst: \([0-9]*\) px.*/\1\t\2\t\3/p' "$report")
  floor=$(sed -n 's/^beyond the characterized raster floor (>13\/channel): \([0-9]*\) px on \([0-9]*\) pages.*/\1\t\2/p' "$report")
  total=$(awk -F'/' '/^- /{gsub(/ /,"",$1); sub(/^-/,"",$1); s+=$1} END{print s+0}' "$report")
  p=$(printf '%s' "$pages" | cut -f1); z=$(printf '%s' "$pages" | cut -f2); w=$(printf '%s' "$pages" | cut -f3)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$prefix" "$p" "$z" "$floor" "$total" "$w" >> "$ledger"
  echo "DONE $prefix pages=$p zero=$z total=$total"
  reports="${WALK_REPORTS:-walk-corpus-reports}"
  mkdir -p "$reports"
  cp "$report" "$reports/$prefix.md"
  rm -rf "$out"
done
echo "CORPUS COMPLETE"
