import type { ComputedStyle } from '../style/types';

/** Result of measuring a text string. */
export interface TextMetrics {
  readonly width: number;
  readonly height: number;
}

/**
 * Abstraction for text measurement.
 * Layout code depends on this interface, never on Canvas directly.
 * Browser: implemented via CanvasRenderingContext2D.measureText()
 * Tests: implemented via MockTextMeasurer with deterministic widths.
 */
export interface TextMeasurer {
  measureText(text: string, style: ComputedStyle): TextMetrics;
}
