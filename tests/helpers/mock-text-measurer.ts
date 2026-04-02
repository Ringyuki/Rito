import type { ComputedStyle } from '../../src/style/types';
import type { TextMeasurer, TextMetrics } from '../../src/layout/text-measurer';

/**
 * Deterministic text measurer for tests.
 * Width = text.length * fontSize * charWidthFactor.
 * Height = fontSize * lineHeight.
 */
export function createMockTextMeasurer(charWidthFactor = 0.6): TextMeasurer {
  return {
    measureText(text: string, style: ComputedStyle): TextMetrics {
      return {
        width: text.length * style.fontSize * charWidthFactor,
        height: style.fontSize * style.lineHeight,
      };
    },
  };
}
