import type { Reader, ReaderLocator } from '@ritojs/core';
import type { ScrollGeometry } from './geometry';

/**
 * Where the reader reads with the strip at device offset `offset`: the
 * line at the reading line of the window under it, else that window's own
 * reading anchor. Only a downward strip's lines are found by their point
 * yet; a leftward one reads its window's anchor.
 */
export async function readingPosition(
  reader: Reader,
  geometry: ScrollGeometry,
  offset: number,
  readingLine: number,
): Promise<ReaderLocator | undefined> {
  const window = geometry.windowAt(offset + readingLine);
  if (window === undefined) return undefined;
  const pageIndex = reader.spreads[window.spreadIndex]?.leftPageIndex;
  if (pageIndex === undefined) return undefined;
  if (geometry.axis === 'down') {
    // The reading line in the window's content box, a pixel in from its start.
    const into = (offset + readingLine - window.start) / geometry.ratio;
    const point = { pageIndex, x: 1, y: into - reader.getLayoutGeometry().marginTop };
    const caret = await reader.interactions?.textSelection?.resolveCaret(point);
    if (caret?.status === 'resolved') return caret.caret.sourceLocator;
  }
  const anchor = await reader.interactions?.getPageReadingAnchor?.(pageIndex);
  return anchor?.status === 'resolved' ? anchor.locator : undefined;
}
