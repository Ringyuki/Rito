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

/** Platform font metrics in CSS px. */
export interface FontMetrics {
  /** Positive distance from alphabetic baseline to the font box top. */
  readonly ascentPx: number;
  /** Positive distance from alphabetic baseline to the font box bottom. */
  readonly descentPx: number;
  /** Extra leading supplied by the font, if the platform exposes it. */
  readonly lineGapPx: number;
  /** The measured content height, normally ascent + descent + line gap. */
  readonly contentHeightPx: number;
}

/**
 * Abstraction for measuring text dimensions.
 *
 * Layout code depends on this interface, never on Canvas directly.
 * Create an instance with a Canvas-backed implementation in browser
 * environments, or provide a custom one for testing / server-side use.
 *
 * The second argument is the minimal paint subset required to measure text:
 * a resolved {@link FontShorthand} plus optional text spacing. Callers
 * assemble it via {@link measurePaintFromStyle} at the call site.
 */
export interface TextMeasurer {
  measureText(text: string, paint: MeasurePaint): TextMetrics;
}

/**
 * Platform capability for resolving font metrics from structured paint.
 *
 * This stays separate from {@link TextMeasurer}: pagination only needs text
 * advances today, while render backends and future line metric work can opt
 * into font metrics without making Canvas a layout dependency.
 */
export interface FontMetricsProvider {
  resolveFontMetrics(paint: MeasurePaint): FontMetrics;
}
