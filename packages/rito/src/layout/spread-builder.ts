import type { LayoutConfig, Page, Spread } from './types';

/**
 * Group pages into spreads for presentation.
 *
 * - **single mode:** each page becomes its own spread (on `left`).
 * - **double mode:** pages are paired left-right. If `firstPageAlone` is true,
 *   the first page stands alone (cover/title), then subsequent pages pair up.
 *   An odd trailing page gets its own spread.
 *
 * @param chapterStartPages - Optional set of page indices that begin a new chapter.
 *   When provided, these pages are forced to start a new spread (as the left page).
 *   This prevents a chapter's opening from appearing as the right page of a spread
 *   alongside the previous chapter's ending, which improves TOC highlighting accuracy
 *   and chapter navigation in double-page mode. Enabled by default when using
 *   {@link buildSpreads} with chapter-aware pagination results.
 *   **Note:** Disabling this may cause TOC highlighting and chapter navigation
 *   to behave unexpectedly in double-page mode.
 */
export function buildSpreads(
  pages: readonly Page[],
  config: LayoutConfig,
  chapterStartPages?: ReadonlySet<number>,
): readonly Spread[] {
  if (pages.length === 0) return [];

  if (config.spreadMode === 'single') {
    return pages.map((page, i) => ({ index: i, left: page }));
  }

  return buildDoubleSpreads(pages, config.firstPageAlone, chapterStartPages);
}

function buildDoubleSpreads(
  pages: readonly Page[],
  firstPageAlone: boolean,
  chapterStartPages?: ReadonlySet<number>,
): Spread[] {
  const spreads: Spread[] = [];
  let i = 0;

  if (firstPageAlone && pages.length > 0) {
    const first = pages[0];
    if (first) spreads.push({ index: 0, left: first });
    i = 1;
  }

  while (i < pages.length) {
    const left = pages[i];
    const right = i + 1 < pages.length ? pages[i + 1] : undefined;

    // If the right page starts a new chapter, don't pair it — let it begin its own spread
    const rightStartsChapter = right && chapterStartPages?.has(right.index);

    const spread: { index: number; left?: Page; right?: Page } = { index: spreads.length };
    if (left) spread.left = left;
    if (right && !rightStartsChapter) spread.right = right;
    spreads.push(spread);
    i += right && !rightStartsChapter ? 2 : 1;
  }

  return spreads;
}
