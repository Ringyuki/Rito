import type { PageGeometry } from './coordinate-mapper';

export function resolveSpreadPage(
  pages: readonly PageGeometry[],
  x: number,
  y: number,
): { pageIndex: number; x: number; y: number } | null {
  // Reverse order gives the later/right page ownership of a shared zero-gap
  // seam while preserving inclusive outer content edges.
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const pg = pages[index];
    if (!pg) continue;
    const localX = x - pg.spreadContentOriginX;
    if (localX >= 0 && localX <= pg.contentWidth && y >= 0 && y <= pg.contentHeight) {
      return { pageIndex: pg.pageIndex, x: localX, y };
    }
  }
  return null;
}
