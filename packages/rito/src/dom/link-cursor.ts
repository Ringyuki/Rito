/**
 * L2 DOM helper: change cursor to pointer over hyperlinks and handle clicks.
 */

import type { LinkRegion } from '../interaction/types';
import { hitTestLink } from '../interaction/link-map';

/**
 * Bind link cursor and click handling on a canvas.
 * `getLinkRegions` is called on each pointer event to get current link regions.
 * Returns a cleanup function.
 */
export function bindLinkCursor(
  canvas: HTMLCanvasElement,
  getLinkRegions: () => readonly LinkRegion[],
  onClick?: (region: LinkRegion) => void,
): () => void {
  function onMove(e: PointerEvent): void {
    const pos = canvasPos(canvas, e);
    const hit = hitTestLink(getLinkRegions(), pos.x, pos.y);
    canvas.style.cursor = hit ? 'pointer' : '';
  }

  function onDown(e: PointerEvent): void {
    if (e.button !== 0 || !onClick) return;
    const pos = canvasPos(canvas, e);
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

function canvasPos(canvas: HTMLCanvasElement, e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
