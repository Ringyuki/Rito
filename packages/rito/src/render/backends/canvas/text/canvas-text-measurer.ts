import type { MeasurePaint } from '../../../../style/core/paint-types';
import type {
  FontMetrics,
  FontMetricsProvider,
  TextMeasurer,
  TextMetrics as LayoutTextMetrics,
} from '../../../../layout/text/text-measurer';
import type { TextMeasurementBackend } from '../../types';
import { buildFontString } from './font-string';
import { textSpacingAdvance } from './spacing';

const FONT_METRICS_SAMPLE = 'Hg';

export type CanvasTextMeasurementTarget =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

/**
 * A Canvas-backed text measurement adapter with internal caches that can be cleared.
 *
 * Call {@link CachedTextMeasurer.clearCache} when the layout context changes
 * (e.g. viewport resize, font-scale change) to discard stale measurements.
 */
export interface CachedTextMeasurer extends TextMeasurer, FontMetricsProvider {
  /** Discard all cached measurements. */
  clearCache(): void;
}

export const canvasTextMeasurementBackend: TextMeasurementBackend<
  CanvasTextMeasurementTarget,
  CachedTextMeasurer
> = {
  createTextMeasurer: createCachedCanvasMeasurer,
};

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
function createCachedCanvasMeasurer(ctx: CanvasTextMeasurementTarget): CachedTextMeasurer {
  const canvasCtx = ctx as CanvasRenderingContext2D;
  const textWidthCache = new Map<string, number>();
  const fontMetricsCache = new Map<string, FontMetrics>();

  return {
    measureText(text: string, paint: MeasurePaint): LayoutTextMetrics {
      const font = buildFontString(paint.font);
      const ws = paint.wordSpacingPx ?? 0;
      const ls = paint.letterSpacingPx ?? 0;
      const cacheKey = font + '\0' + String(ws) + '\0' + String(ls) + '\0' + text;
      let width = textWidthCache.get(cacheKey);

      if (width === undefined) {
        canvasCtx.font = font;
        resetCanvasSpacing(canvasCtx);
        const metrics = canvasCtx.measureText(text);
        width = metrics.width + textSpacingAdvance(text, ws, ls);
        textWidthCache.set(cacheKey, width);
      }

      // Content-box height only — layout must not source line-box height from here.
      return { width, height: paint.font.sizePx };
    },

    resolveFontMetrics(paint: MeasurePaint): FontMetrics {
      const font = buildFontString(paint.font);
      let fontMetrics = fontMetricsCache.get(font);
      if (fontMetrics === undefined) {
        canvasCtx.font = font;
        resetCanvasSpacing(canvasCtx);
        fontMetrics = resolveCanvasFontMetrics(canvasCtx.measureText(FONT_METRICS_SAMPLE), paint);
        fontMetricsCache.set(font, fontMetrics);
      }
      return fontMetrics;
    },

    clearCache(): void {
      textWidthCache.clear();
      fontMetricsCache.clear();
    },
  };
}

function resetCanvasSpacing(ctx: CanvasRenderingContext2D): void {
  ctx.wordSpacing = '0px';
  ctx.letterSpacing = '0px';
}

interface CanvasFontMetricsLike {
  readonly fontBoundingBoxAscent?: number;
  readonly fontBoundingBoxDescent?: number;
  readonly actualBoundingBoxAscent?: number;
  readonly actualBoundingBoxDescent?: number;
}

function resolveCanvasFontMetrics(
  metrics: CanvasFontMetricsLike,
  paint: MeasurePaint,
): FontMetrics {
  const ascent = firstValidMetric(
    paint.font.sizePx,
    metrics.fontBoundingBoxAscent,
    metrics.actualBoundingBoxAscent,
  );
  const descent = firstValidMetric(
    0,
    metrics.fontBoundingBoxDescent,
    metrics.actualBoundingBoxDescent,
  );
  const lineGap = 0;
  return {
    ascentPx: ascent,
    descentPx: descent,
    lineGapPx: lineGap,
    contentHeightPx: ascent + descent + lineGap,
  };
}

function firstValidMetric(fallback: number, ...values: readonly (number | undefined)[]): number {
  for (const value of values) {
    if (value !== undefined && Number.isFinite(value) && value >= 0) return value;
  }
  return fallback;
}
