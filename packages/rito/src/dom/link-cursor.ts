/**
 * Change cursor to pointer over hyperlinks and handle clicks.
 *
 * Coordinates are converted from DOM event coordinates to page-content space
 * for hit-testing against link regions. By default this is a simple subtraction
 * of the canvas bounding rect, which is only correct when margins are zero and
 * renderScale is 1. For correct behaviour with margins and scaling, pass a
 * custom `transform` function (e.g. from a CoordinateMapper).
 *
 * @param canvas - The canvas element to listen on.
 * @param getLinkRegions - Returns the current link regions (page-content space).
 * @param transform - Optional custom coordinate transform. When omitted, uses
 *   `clientX/Y - canvasRect.left/top` (no margin or scale adjustment).
 * @param onClick - Optional click handler for matched links.
 * @returns A cleanup function.
 */

import type { LinkRegion } from '../interaction/core';
import { hitTestLink } from '../interaction/core';

export function bindLinkCursor(
  canvas: HTMLCanvasElement,
  getLinkRegions: () => readonly LinkRegion[],
  transform?: (e: PointerEvent) => { x: number; y: number },
  onClick?: (region: LinkRegion) => void,
): () => void {
  const toLocal =
    transform ??
    ((e: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });

  function onMove(e: PointerEvent): void {
    const pos = toLocal(e);
    const hit = hitTestLink(getLinkRegions(), pos.x, pos.y);
    canvas.style.cursor = hit ? 'pointer' : '';
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0 || !onClick) return;
    const pos = toLocal(e);
    const hit = hitTestLink(getLinkRegions(), pos.x, pos.y);
    if (hit) onClick(hit);
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);

  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.style.cursor = '';
  };
}
