#!/bin/sh
# Keep each walk's report.md + top-level log; drop the heavy captures
# (engine/truth/gallery PNGs and the unpacked book). Pass walk dirs to
# spare in full as arguments.
cd "$(dirname "$0")" || exit 1
for dir in walk-*/; do
  keep=0
  for spare in "$@"; do
    [ "${dir%/}" = "${spare%/}" ] && keep=1
  done
  [ "$keep" = 1 ] && continue
  rm -rf "${dir}engine" "${dir}truth" "${dir}gallery" "${dir}book"
done
du -sh . | awk '{print "corpus-oracle now: " $1}'
