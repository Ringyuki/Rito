import type { PageGeometry } from './coordinate-mapper';

export function resolveSpreadPage(
  pages: readonly PageGeometry[],
  x: number,
  y: number,
): { pageIndex: number; x: number; y: number } | null {
  for (const pg of pages) {
    const localX = x - pg.spreadContentOriginX;
    if (localX >= 0 && localX <= pg.contentWidth && y >= 0 && y <= pg.contentHeight) {
      return { pageIndex: pg.pageIndex, x: localX, y };
    }
  }
  return null;
}
