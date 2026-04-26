import type { MeasurePaint } from '../../src/style/core/paint-types';
import type {
  FontMetrics,
  FontMetricsProvider,
  TextMeasurer,
  TextMetrics,
} from '../../src/layout/text/text-measurer';

type MockTextMeasurer = TextMeasurer &
  FontMetricsProvider & {
    clearCache(): void;
  };

/**
 * Deterministic text measurer for tests.
 * Width = text.length * fontSize * charWidthFactor.
 * Height = fontSize (content-box only; lineHeight is out of measurer scope).
 */
export function createMockTextMeasurer(charWidthFactor = 0.6): MockTextMeasurer {
  return {
    measureText(text: string, paint: MeasurePaint): TextMetrics {
      const sizePx = paint.font.sizePx;
      return {
        width:
          text.length * sizePx * charWidthFactor +
          countAsciiSpaces(text) * (paint.wordSpacingPx ?? 0) +
          countLetterSpacingGaps(text) * (paint.letterSpacingPx ?? 0),
        height: sizePx,
      };
    },
    resolveFontMetrics(paint: MeasurePaint): FontMetrics {
      const sizePx = paint.font.sizePx;
      return {
        ascentPx: sizePx,
        descentPx: 0,
        lineGapPx: 0,
        contentHeightPx: sizePx,
      };
    },
    clearCache(): void {
      // No-op for mock measurer.
    },
  };
}

function countAsciiSpaces(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === ' ') count++;
  }
  return count;
}

function countLetterSpacingGaps(text: string): number {
  const units = Array.from(text).length;
  return units > 1 ? units - 1 : 0;
}
