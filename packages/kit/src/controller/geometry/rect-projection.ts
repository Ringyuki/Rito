import type { Rect } from 'rito/advanced';
import type { LayoutGeometry, PageGeometry } from './coordinate-mapper';

export function spreadContentRectToViewport(g: LayoutGeometry, rect: Rect): Rect {
  return {
    x: rect.x + g.marginLeft,
    y: rect.y + g.marginTop,
    width: rect.width,
    height: rect.height,
  };
}

export function toViewport(
  pageMap: ReadonlyMap<number, PageGeometry>,
  pageIndex: number,
  rect: Rect,
): Rect {
  const pg = pageMap.get(pageIndex);
  if (!pg) return rect;
  return {
    x: rect.x + pg.contentOriginX,
    y: rect.y + pg.contentOriginY,
    width: rect.width,
    height: rect.height,
  };
}

export function scaleRect(rect: Rect, scale: number): Rect {
  return {
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

export function toScreen(
  pageMap: ReadonlyMap<number, PageGeometry>,
  pageIndex: number,
  rect: Rect,
  canvasRect: { left: number; top: number },
  renderScale: number,
): Rect {
  const pg = pageMap.get(pageIndex);
  if (!pg) return rect;
  return {
    x: canvasRect.left + (rect.x + pg.contentOriginX) * renderScale,
    y: canvasRect.top + (rect.y + pg.contentOriginY) * renderScale,
    width: rect.width * renderScale,
    height: rect.height * renderScale,
  };
}
