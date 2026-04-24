import type { MeasurePaint } from '../../style/core/paint-types';
import type { TextMeasurer, TextMetrics } from '../../layout/text/text-measurer';
import { buildFontString } from './font-string';
import { textSpacingAdvance } from './spacing';

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
 * Uses Canvas' advance width (`TextMetrics.width`), matching browser inline
 * layout. Glyph ink may overhang that advance box; it must not shift centered
 * or right-aligned text.
 *
 * Results are cached by font string + text spacing + text to avoid redundant
 * canvas measurements. Call {@link CachedTextMeasurer.clearCache} to reset.
 */
export function createCanvasTextMeasurer(ctx: CanvasRenderingContext2D): CachedTextMeasurer {
  const cache = new Map<string, number>();

  return {
    measureText(text: string, paint: MeasurePaint): TextMetrics {
      const font = buildFontString(paint.font);
      const ws = paint.wordSpacingPx ?? 0;
      const ls = paint.letterSpacingPx ?? 0;
      const cacheKey = font + '\0' + String(ws) + '\0' + String(ls) + '\0' + text;
      let width = cache.get(cacheKey);

      if (width === undefined) {
        ctx.font = font;
        ctx.wordSpacing = '0px';
        ctx.letterSpacing = '0px';
        const metrics = ctx.measureText(text);
        width = metrics.width + textSpacingAdvance(text, ws, ls);
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
