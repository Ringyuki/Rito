import type { ChapterRange, Reader } from '@ritojs/core';

export function chapterHrefForIdref(reader: Reader, idref: string): string {
  return reader.manifestHrefMap.get(idref) ?? idref;
}

/** Page ranges keyed only by canonical resource href. */
export function buildChapterPageRanges(reader: Reader): ReadonlyMap<string, ChapterRange> {
  const ranges = new Map<string, ChapterRange>();
  for (const [idref, range] of reader.chapterMap) {
    ranges.set(chapterHrefForIdref(reader, idref), range);
  }
  return ranges;
}

/** Recover publication order from page projections, not idref map iteration order. */
export function findChapterSpineIndex(reader: Reader, href: string): number {
  const chapters = [...reader.chapterMap].sort(
    ([leftIdref, left], [rightIdref, right]) =>
      left.startPage - right.startPage ||
      left.endPage - right.endPage ||
      leftIdref.localeCompare(rightIdref),
  );
  const index = chapters.findIndex(
    ([idref]) => idref === href || chapterHrefForIdref(reader, idref) === href,
  );
  return index < 0 ? 0 : index;
}
