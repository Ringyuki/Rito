/**
 * Options for {@link renderPage}.
 */
export interface RenderOptions {
  /** Fill color for the page background. If omitted, no background is drawn. */
  readonly backgroundColor?: string;
  /**
   * Body background color resolved at the spread level (for dual-page mode).
   * When set, overrides `page.paint?.backgroundColor` so that adjacent pages
   * share a unified background when only one of them specifies a body bg.
   * This is an internal field set by the spread renderer.
   */
  readonly spreadBodyBg?: string;
  /**
   * Override text color for theme support (e.g. dark mode).
   * When set, text whose original color has insufficient contrast against
   * {@link backgroundColor} will be rendered in this color instead.
   * Requires {@link backgroundColor} to be set for contrast detection.
   */
  readonly foregroundColor?: string;
  /**
   * Device pixel ratio for high-DPI rendering.
   * The canvas should be sized to `pageWidth * pixelRatio` by `pageHeight * pixelRatio`.
   * Defaults to 1.
   */
  readonly pixelRatio?: number;
  /** Decoded image bitmaps from {@link loadImages}. Required for image rendering. */
  readonly images?: ReadonlyMap<string, ImageBitmap>;
}
