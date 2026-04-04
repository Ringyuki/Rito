import type { ComputedStyle } from '../../src/style/types';
import type { TextMetrics } from '../../src/layout/text/text-measurer';
import type { CachedTextMeasurer } from '../../src/render/canvas-text-measurer';

/**
 * Deterministic text measurer for tests.
 * Width = text.length * fontSize * charWidthFactor.
 * Height = fontSize * lineHeight.
 */
export function createMockTextMeasurer(charWidthFactor = 0.6): CachedTextMeasurer {
  return {
    measureText(text: string, style: ComputedStyle): TextMetrics {
      return {
        width: text.length * style.fontSize * charWidthFactor,
        height: style.fontSize * style.lineHeight,
      };
    },
    clearCache(): void {
      // No-op for mock measurer.
    },
  };
}
