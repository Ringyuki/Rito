import type { LayoutConfig, Page, Spread } from './types';

/**
 * Group pages into spreads for presentation.
 *
 * - **single mode:** each page becomes its own spread (on `left`).
 * - **double mode:** pages are paired left-right. If `firstPageAlone` is true,
 *   the first page stands alone (cover/title), then subsequent pages pair up.
 *   An odd trailing page gets its own spread.
 */
export function buildSpreads(pages: readonly Page[], config: LayoutConfig): readonly Spread[] {
  if (pages.length === 0) return [];

  if (config.spreadMode === 'single') {
    return pages.map((page, i) => ({ index: i, left: page }));
  }

  return buildDoubleSpreads(pages, config.firstPageAlone);
}

function buildDoubleSpreads(pages: readonly Page[], firstPageAlone: boolean): Spread[] {
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
    const spread: { index: number; left?: Page; right?: Page } = { index: spreads.length };
    if (left) spread.left = left;
    if (right) spread.right = right;
    spreads.push(spread);
    i += right ? 2 : 1;
  }

  return spreads;
}
