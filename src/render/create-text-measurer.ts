import type { TextMeasurer } from '../layout/text-measurer';
import { createCanvasTextMeasurer } from './canvas-text-measurer';

/**
 * Create a TextMeasurer from a canvas element.
 * Convenience wrapper for the public API.
 */
export function createTextMeasurer(canvas: HTMLCanvasElement | OffscreenCanvas): TextMeasurer {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2d context from canvas');
  }
  return createCanvasTextMeasurer(ctx as CanvasRenderingContext2D);
}
