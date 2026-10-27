import type { ReaderExactTextRangeRect } from '@ritojs/core';
import type { Rect } from '../interaction/layout-types';
import type { OverlayLayer } from '../painter/types';
import { windowRect } from './composite';
import type { ScrollGeometry, ScrollWindow } from './geometry';

/** A page's rect in its content box, in CSS pixels, as the reader's interactions give it. */
export type ScrollPageRect = Pick<
  ReaderExactTextRangeRect,
  'pageIndex' | 'x' | 'y' | 'width' | 'height'
>;

/**
 * What an app shows over a scrolled view's text, a search's matches or a
 * book's annotations: rects of pages, drawn over each window that shows
 * them and moved with it.
 */
export interface ScrollHighlight {
  readonly id: string;
  readonly rects: readonly ScrollPageRect[];
  /** A CSS colour. */
  readonly color: string;
  /** Higher highlights are drawn over lower ones; the selection is drawn at 0. */
  readonly zIndex?: number | undefined;
  /** How each rect is marked: filled (the default), or a line along its bottom edge. */
  readonly mark?: 'fill' | 'underline' | undefined;
}

/** A page's content box in its window's display list: the page's margins in. */
export interface ScrollPageOrigin {
  readonly marginLeft: number;
  readonly marginTop: number;
}

/**
 * The highlights drawn over the window showing page `pageIndex`, in CSS
 * pixels of the window's display list.
 */
export function windowLayers(
  pageIndex: number,
  origin: ScrollPageOrigin,
  highlights: readonly ScrollHighlight[],
): OverlayLayer[] {
  return highlights.map((highlight) => ({
    id: highlight.id,
    color: highlight.color,
    zIndex: highlight.zIndex ?? 0,
    mark: highlight.mark,
    rects: highlight.rects
      .filter((rect) => rect.pageIndex === pageIndex)
      .map((rect) => ({
        x: rect.x + origin.marginLeft,
        y: rect.y + origin.marginTop,
        width: rect.width,
        height: rect.height,
      })),
  }));
}

/**
 * Page rects where a view shows them, in CSS pixels from the view's
 * top-left corner, with the strip at device offset `offset` on a view
 * `width` × `height` device pixels; a rect of a page no window on screen
 * shows is left out.
 */
export function viewRects(
  geometry: ScrollGeometry,
  pageOf: (window: ScrollWindow) => number | undefined,
  origin: ScrollPageOrigin,
  offset: number,
  width: number,
  height: number,
  rects: readonly ScrollPageRect[],
): Rect[] {
  const { ratio } = geometry;
  const at = Math.round(offset);
  const shown = geometry.visible(at, geometry.axis === 'down' ? height : width);
  const placed: Rect[] = [];
  for (const window of shown) {
    const pageIndex = pageOf(window);
    const corner = windowRect(geometry, window, at, width, height);
    for (const rect of rects) {
      if (rect.pageIndex !== pageIndex) continue;
      placed.push({
        x: corner.x / ratio + origin.marginLeft + rect.x,
        y: corner.y / ratio + origin.marginTop + rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  }
  return placed;
}
