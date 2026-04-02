/**
 * Renderer types.
 * Only rendering code should touch CanvasRenderingContext2D.
 */

/** Options for the canvas renderer. */
export interface RenderOptions {
  readonly backgroundColor?: string;
  readonly pixelRatio?: number;
}
