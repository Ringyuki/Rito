import type { ComputedStyle } from '../style/types';
import type { TextMeasurer, TextMetrics } from '../layout/text-measurer';
import { buildFontString } from './font-string';

/**
 * Text measurer backed by CanvasRenderingContext2D.
 *
 * Uses the ink bounding box (actualBoundingBoxLeft + actualBoundingBoxRight)
 * rather than advance width alone, to prevent last-character clipping when
 * the rendered glyph extends beyond the advance width.
 */
export function createCanvasTextMeasurer(ctx: CanvasRenderingContext2D): TextMeasurer {
  return {
    measureText(text: string, style: ComputedStyle): TextMetrics {
      ctx.font = buildFontString(style);
      const metrics = ctx.measureText(text);

      // metrics.width = advance width (cursor movement)
      // actualBoundingBoxLeft + actualBoundingBoxRight = ink bounds (actual pixels)
      // Use the larger of the two to prevent clipping.
      const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
      let width = Math.max(metrics.width, inkWidth);
      if (style.wordSpacing !== 0) {
        const spaces = text.split(' ').length - 1;
        width += spaces * style.wordSpacing;
      }

      return {
        width,
        height: style.fontSize * style.lineHeight,
      };
    },
  };
}
