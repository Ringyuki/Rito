import type { ComputedStyle } from '../style/types';

/** Result of measuring a text string. */
export interface TextMetrics {
  readonly width: number;
  readonly height: number;
}

/**
 * Abstraction for measuring text dimensions.
 *
 * Layout code depends on this interface, never on Canvas directly.
 * Create an instance with {@link createTextMeasurer} in browser environments,
 * or provide a custom implementation for testing or server-side use.
 */
export interface TextMeasurer {
  measureText(text: string, style: ComputedStyle): TextMetrics;
}
