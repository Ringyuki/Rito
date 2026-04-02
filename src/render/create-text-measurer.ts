import type { TextMeasurer } from '../layout/text-measurer';
import { createCanvasTextMeasurer } from './canvas-text-measurer';

/**
 * Create a {@link TextMeasurer} from a canvas element.
 *
 * The returned measurer uses the canvas 2D context to measure text widths
 * using the browser's font engine. Pass it to {@link paginate} to compute layout.
 *
 * @param canvas - An HTMLCanvasElement or OffscreenCanvas.
 * @returns A {@link TextMeasurer} backed by the canvas context.
 * @throws If the canvas does not support a 2D context.
 *
 * @example
 * ```ts
 * const measurer = createTextMeasurer(document.createElement('canvas'));
 * const pages = paginate(doc, config, measurer);
 * ```
 */
export function createTextMeasurer(canvas: HTMLCanvasElement | OffscreenCanvas): TextMeasurer {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2d context from canvas');
  }
  return createCanvasTextMeasurer(ctx as CanvasRenderingContext2D);
}
