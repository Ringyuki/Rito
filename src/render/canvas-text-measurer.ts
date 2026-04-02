import type { ComputedStyle } from '../style/types';
import type { TextMeasurer, TextMetrics } from '../layout/text-measurer';

/** Build a CSS font string from a ComputedStyle. */
function buildFontString(style: ComputedStyle): string {
  const parts: string[] = [];
  if (style.fontStyle === 'italic') parts.push('italic');
  if (style.fontWeight === 'bold') parts.push('bold');
  parts.push(`${String(style.fontSize)}px`);
  parts.push(style.fontFamily);
  return parts.join(' ');
}

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
