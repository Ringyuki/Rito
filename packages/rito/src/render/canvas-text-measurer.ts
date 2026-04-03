import type { ComputedStyle } from '../style/types';
import type { TextMeasurer, TextMetrics } from '../layout/text-measurer';
import { buildFontString } from './font-string';

/**
 * Text measurer backed by CanvasRenderingContext2D with a measurement cache.
 *
 * Uses the ink bounding box (actualBoundingBoxLeft + actualBoundingBoxRight)
 * rather than advance width alone, to prevent last-character clipping when
 * the rendered glyph extends beyond the advance width.
 *
 * Results are cached by font string + text to avoid redundant canvas measurements.
 */
export function createCanvasTextMeasurer(ctx: CanvasRenderingContext2D): TextMeasurer {
  const cache = new Map<string, number>();

  return {
    measureText(text: string, style: ComputedStyle): TextMetrics {
      const font = buildFontString(style);
      const cacheKey = font + '\0' + text;
      let width = cache.get(cacheKey);

      if (width === undefined) {
        ctx.font = font;
        const metrics = ctx.measureText(text);
        const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
        width = Math.max(metrics.width, inkWidth);
        if (style.wordSpacing !== 0) {
          const spaces = text.split(' ').length - 1;
          width += spaces * style.wordSpacing;
        }
        cache.set(cacheKey, width);
      }

      return { width, height: style.fontSize * style.lineHeight };
    },
  };
}
