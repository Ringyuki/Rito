import type { ComputedStyle } from '../style/types';
import type { TextMeasurer, TextMetrics } from '../layout/text-measurer';
import { buildFontString } from './font-string';

/**
 * Text measurer backed by CanvasRenderingContext2D.
 * Uses the browser's font engine for accurate text measurement.
 */
export function createCanvasTextMeasurer(ctx: CanvasRenderingContext2D): TextMeasurer {
  return {
    measureText(text: string, style: ComputedStyle): TextMetrics {
      ctx.font = buildFontString(style);
      const metrics = ctx.measureText(text);
      return {
        width: metrics.width,
        height: style.fontSize * style.lineHeight,
      };
    },
  };
}
