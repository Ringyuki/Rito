import type { LayoutConfig, Page, Spread } from '../core/types';

export function buildSpreads(
  pages: readonly Page[],
  config: LayoutConfig,
  chapterStartPages?: ReadonlySet<number>,
): readonly Spread[] {
  if (pages.length === 0) return [];

  if (config.spreadMode === 'single') {
    return pages.map((page, index) => ({ index, left: page }));
  }

  return buildDoubleSpreads(pages, config.firstPageAlone, chapterStartPages);
}

function buildDoubleSpreads(
  pages: readonly Page[],
  firstPageAlone: boolean,
  chapterStartPages?: ReadonlySet<number>,
): Spread[] {
  const spreads: Spread[] = [];
  let index = 0;

  if (firstPageAlone && pages.length > 0) {
    const first = pages[0];
    if (first) spreads.push({ index: 0, left: first });
    index = 1;
  }

  while (index < pages.length) {
    const left = pages[index];
    const right = index + 1 < pages.length ? pages[index + 1] : undefined;
    const rightStartsChapter = right && chapterStartPages?.has(right.index);

    const spread: { index: number; left?: Page; right?: Page } = { index: spreads.length };
    if (left) spread.left = left;
    if (right && !rightStartsChapter) spread.right = right;
    spreads.push(spread);
    index += right && !rightStartsChapter ? 2 : 1;
  }

  return spreads;
}
