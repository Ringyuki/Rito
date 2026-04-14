import type { MeasurePaint } from '../../style/core/paint-types';
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
    measureText(text: string, paint: MeasurePaint): TextMetrics {
      const font = buildFontString(paint.font);
      const ws = paint.wordSpacingPx ?? 0;
      const cacheKey = font + '\0' + String(ws) + '\0' + text;
      let width = cache.get(cacheKey);

      if (width === undefined) {
        ctx.font = font;
        const metrics = ctx.measureText(text);
        const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
        width = Math.max(metrics.width, inkWidth);
        if (ws !== 0) {
          const spaces = text.split(' ').length - 1;
          width += spaces * ws;
        }
        cache.set(cacheKey, width);
      }

      // Content-box height only — layout must not source line-box height from here.
      return { width, height: paint.font.sizePx };
    },

    clearCache(): void {
      cache.clear();
    },
  };
}
