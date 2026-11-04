import type { Rect } from '../interaction/layout-types';
import type { ScrollPoint } from './hit';
import type { ScrollController } from './types';
import { shownRects, type ScrollView } from './view';

/** One of the app's highlights under a point of the view (see `setHighlights`). */
export interface ScrollHighlightHit {
  readonly id: string;
  /**
   * Its rects on the point's page, bounded, in screen coordinates (CSS
   * pixels for `position: fixed`): where a tooltip or a popover for it goes.
   */
  readonly bounds: Rect;
}

/**
 * The app's highlight under `point`: of those with a rect there, the one
 * drawn on top (the highest `zIndex`, the later of equals), as a page
 * view's annotations are hit before its links.
 */
export function highlightAt(view: ScrollView, point: ScrollPoint): ScrollHighlightHit | null {
  let hit: ScrollView['highlights'][number] | undefined;
  for (const highlight of view.highlights) {
    if (!highlight.rects.some((rect) => rect.pageIndex === point.pageIndex && holds(rect, point))) {
      continue;
    }
    if (hit === undefined || (highlight.zIndex ?? 0) >= (hit.zIndex ?? 0)) hit = highlight;
  }
  if (hit === undefined) return null;
  const onPage = hit.rects.filter((rect) => rect.pageIndex === point.pageIndex);
  const [shown] = shownRects(view, [{ pageIndex: point.pageIndex, ...bounding(onPage) }]);
  if (shown === undefined) return null;
  const canvas = view.surface.canvas.getBoundingClientRect();
  return { id: hit.id, bounds: { ...shown, x: shown.x + canvas.left, y: shown.y + canvas.top } };
}

/**
 * The highlight under a mouse that rests on the view with no button
 * pressed, told (`highlightHover`) each time it changes or the strip moves
 * it under the mouse, and as gone when the mouse leaves or presses.
 */
export function wireHighlightHover(
  view: ScrollView,
  controller: ScrollController,
  canvas: HTMLCanvasElement,
): () => void {
  let hovered: ScrollHighlightHit | null = null;
  // Where the mouse rests on the view, in its CSS pixels; null once it left or pressed.
  let mouse: { x: number; y: number } | null = null;
  const tell = (): void => {
    const point = mouse === null ? undefined : controller.pointAt(mouse.x, mouse.y);
    const hit = point === undefined ? null : highlightAt(view, point);
    if (sameHit(hit, hovered)) return;
    hovered = hit;
    view.emitter.emit('highlightHover', { highlight: hit });
  };
  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    const rect = canvas.getBoundingClientRect();
    mouse =
      event.buttons === 0 ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null;
    tell();
  };
  const onLeave = (): void => {
    mouse = null;
    tell();
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onLeave);
  canvas.addEventListener('pointerleave', onLeave);
  const stopScroll = controller.on('scroll', () => {
    if (mouse !== null || hovered !== null) tell();
  });
  return () => {
    stopScroll();
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onLeave);
    canvas.removeEventListener('pointerleave', onLeave);
  };
}

function sameHit(a: ScrollHighlightHit | null, b: ScrollHighlightHit | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.bounds.x === b.bounds.x && a.bounds.y === b.bounds.y;
}

function holds(rect: Rect, point: { readonly x: number; readonly y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function bounding(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
