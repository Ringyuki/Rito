/**
 * Bind pointer events from an HTMLCanvasElement to a SelectionEngine.
 *
 * Coordinates are converted from DOM event coordinates to the space expected
 * by the SelectionEngine. By default this is a simple subtraction of the
 * canvas bounding rect, which is only correct when margins are zero and
 * renderScale is 1. For correct behaviour with margins and scaling, pass a
 * custom `transform` function (e.g. from a CoordinateMapper).
 *
 * @param canvas - The canvas element to listen on.
 * @param engine - The SelectionEngine to drive.
 * @param transform - Optional custom coordinate transform. When omitted, uses
 *   `clientX/Y - canvasRect.left/top` (spread-local CSS pixels, no margin or
 *   scale adjustment).
 * @returns A cleanup function that removes all listeners.
 */

import type { SelectionEngine } from '../interaction/selection';

export function bindPointerEvents(
  canvas: HTMLCanvasElement,
  engine: SelectionEngine,
  transform?: (e: PointerEvent) => { x: number; y: number },
): () => void {
  const toLogical =
    transform ??
    ((e: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });

  function onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    engine.handlePointerDown(toLogical(e));
  }

  function onMove(e: PointerEvent): void {
    engine.handlePointerMove(toLogical(e));
  }

  function onUp(e: PointerEvent): void {
    engine.handlePointerUp(toLogical(e));
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
  };
}
