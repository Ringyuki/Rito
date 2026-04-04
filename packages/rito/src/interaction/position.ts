import type { Page, Spread } from '../layout/core/types';
import type { ChapterRange } from '../runtime/types';

/** A serializable reading position. */
export interface ReadingPosition {
  readonly spreadIndex: number;
  readonly pageIndex: number;
  readonly chapterHref?: string;
  readonly progress: number;
  readonly timestamp: number;
}

/** Create a ReadingPosition from the current spread index. */
export function createReadingPosition(
  spreads: readonly Spread[],
  pages: readonly Page[],
  chapterMap: ReadonlyMap<string, ChapterRange>,
  spreadIndex: number,
): ReadingPosition {
  const clamped = Math.max(0, Math.min(spreadIndex, spreads.length - 1));
  const spread = spreads[clamped];
  const pageIndex = spread?.left?.index ?? spread?.right?.index ?? 0;
  const progress = pages.length > 0 ? pageIndex / pages.length : 0;
  const chapterHref = findChapterHref(pageIndex, chapterMap);

  const base = { spreadIndex: clamped, pageIndex, progress, timestamp: Date.now() };
  return chapterHref ? { ...base, chapterHref } : base;
}

/** Resolve a saved ReadingPosition back to a valid spread index. */
export function resolveReadingPosition(
  position: ReadingPosition,
  spreads: readonly Spread[],
): number {
  if (spreads.length === 0) return 0;
  return Math.max(0, Math.min(position.spreadIndex, spreads.length - 1));
}

function findChapterHref(
  pageIndex: number,
  chapterMap: ReadonlyMap<string, ChapterRange>,
): string | undefined {
  for (const [href, range] of chapterMap) {
    if (pageIndex >= range.startPage && pageIndex <= range.endPage) return href;
  }
  return undefined;
}
