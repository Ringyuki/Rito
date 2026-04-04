import type { ComputedStyle } from '../../style/core/types';
import type { TextMeasurer, TextMetrics } from '../../layout/text/text-measurer';
import { buildFontString } from './font-string';

/**
 * A {@link TextMeasurer} with an internal measurement cache that can be cleared.
 *
 * Call {@link CachedTextMeasurer.clearCache} when the layout context changes
 * (e.g. viewport resize, font-scale change) to discard stale measurements.
 */
export interface CachedTextMeasurer extends TextMeasurer {
  /** Discard all cached measurements. */
  clearCache(): void;
}

/**
 * Text measurer backed by CanvasRenderingContext2D with a measurement cache.
 *
 * Uses the ink bounding box (actualBoundingBoxLeft + actualBoundingBoxRight)
 * rather than advance width alone, to prevent last-character clipping when
 * the rendered glyph extends beyond the advance width.
 *
 * Results are cached by font string + text + wordSpacing to avoid redundant
 * canvas measurements. Call {@link CachedTextMeasurer.clearCache} to reset.
 */
export function createCanvasTextMeasurer(ctx: CanvasRenderingContext2D): CachedTextMeasurer {
  const cache = new Map<string, number>();

  return {
    measureText(text: string, style: ComputedStyle): TextMetrics {
      const font = buildFontString(style);
      const cacheKey = font + '\0' + String(style.wordSpacing) + '\0' + text;
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

    clearCache(): void {
      cache.clear();
    },
  };
}
