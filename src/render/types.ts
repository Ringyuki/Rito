/**
 * Options for {@link renderPage}.
 */
export interface RenderOptions {
  /** Fill color for the page background. If omitted, no background is drawn. */
  readonly backgroundColor?: string;
  /**
   * Device pixel ratio for high-DPI rendering.
   * The canvas should be sized to `pageWidth * pixelRatio` by `pageHeight * pixelRatio`.
   * Defaults to 1.
   */
  readonly pixelRatio?: number;
  /** Decoded image bitmaps from {@link loadImages}. Required for image rendering. */
  readonly images?: ReadonlyMap<string, ImageBitmap>;
}
