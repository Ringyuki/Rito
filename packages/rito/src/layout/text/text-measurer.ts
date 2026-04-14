import type { MeasurePaint } from '../../style/core/paint-types';

/** Result of measuring a text string. */
export interface TextMetrics {
  readonly width: number;
  /**
   * Nominal content-box height in px. Equal to the font's sizePx — it does
   * NOT include line-height. Callers that need line-box height must compute
   * it from the line-box geometry, not from measurer output.
   */
  readonly height: number;
}

/**
 * Abstraction for measuring text dimensions.
 *
 * Layout code depends on this interface, never on Canvas directly.
 * Create an instance with a Canvas-backed implementation in browser
 * environments, or provide a custom one for testing / server-side use.
 *
 * The second argument is the minimal paint subset required to measure text:
 * a resolved {@link FontShorthand} plus optional word-spacing. Callers assemble
 * it via {@link measurePaintFromStyle} at the call site.
 */
export interface TextMeasurer {
  measureText(text: string, paint: MeasurePaint): TextMetrics;
}
