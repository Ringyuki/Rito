import type { Reader, ReaderInteractionTarget } from '@ritojs/core';
import type { ScrollGeometry } from './geometry';

/** A point of a scrolled view: its window, that window's page and the point in its content box (CSS pixels). */
export interface ScrollPoint {
  readonly spreadIndex: number;
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The point under view coordinates `x`, `y` (CSS pixels from the view's
 * top-left corner) with the strip at device offset `offset` on a view
 * `width` device pixels wide.
 */
export function scrollPointAt(
  reader: Reader,
  geometry: ScrollGeometry,
  offset: number,
  width: number,
  x: number,
  y: number,
): ScrollPoint | undefined {
  const { ratio } = geometry;
  // How far along the strip the point is, and across it, in device pixels.
  const along = geometry.axis === 'down' ? offset + y * ratio : offset + width - x * ratio;
  const window = geometry.windowAt(along);
  if (window === undefined || along < window.start || along >= window.start + window.length) {
    return undefined;
  }
  const pageIndex = reader.spreads[window.spreadIndex]?.leftPageIndex;
  if (pageIndex === undefined) return undefined;
  const into = (along - window.start) / ratio;
  const margins = reader.getLayoutGeometry();
  // The point in the window's own display list, then in its content box.
  const [windowX, windowY] =
    geometry.axis === 'down' ? [x, into] : [window.length / ratio - into, y];
  return {
    spreadIndex: window.spreadIndex,
    pageIndex,
    x: windowX - margins.marginLeft,
    y: windowY - margins.marginTop,
  };
}

/** The interaction target at a point of a scrolled view, if any. */
export async function scrollTargetAt(
  reader: Reader,
  point: ScrollPoint,
): Promise<ReaderInteractionTarget | undefined> {
  const page = await reader.interactions?.getPageTargets(point.pageIndex);
  return page?.targets.find(
    ({ bounds }) =>
      point.x >= bounds.x &&
      point.x < bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y < bounds.y + bounds.height,
  );
}
