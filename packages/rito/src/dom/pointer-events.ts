/**
 * L2 DOM helper: bind pointer events from an HTMLCanvasElement to a SelectionEngine.
 * Translates DOM coordinates to spread-local logical coordinates.
 */

import type { SelectionEngine } from '../interaction/selection-engine';

/**
 * Bind pointer events on a canvas to drive a SelectionEngine.
 * Coordinates are converted from CSS pixels to spread-local logical pixels.
 * Returns a cleanup function that removes all listeners.
 */
export function bindPointerEvents(canvas: HTMLCanvasElement, engine: SelectionEngine): () => void {
  function toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

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
