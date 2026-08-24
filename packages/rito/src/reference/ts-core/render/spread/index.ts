import type { LayoutConfig, Spread } from '../../layout/core/types';
import {
  canvasDisplayListRenderer,
  type CanvasRenderingTarget,
  type CanvasRenderOptions,
} from '../backends/canvas';
import { buildSpreadDisplayList } from '../display-list';

/**
 * Render a spread onto a Canvas 2D target.
 *
 * Renders a single-page or two-page spread onto the canvas.
 *
 * The canvas should be sized to `viewportWidth × viewportHeight` (× pixelRatio).
 */
export function render(
  spread: Spread,
  ctx: CanvasRenderingTarget,
  config: LayoutConfig,
  options?: CanvasRenderOptions,
): void {
  canvasDisplayListRenderer.render(buildSpreadDisplayList(spread, config, options), ctx, {
    ...(options?.pixelRatio !== undefined ? { pixelRatio: options.pixelRatio } : {}),
    ...(options?.imageResolver ? { imageResolver: options.imageResolver } : {}),
    ...(options?.images ? { images: options.images } : {}),
  });
}

/**
 * Compute the canvas dimensions needed for a config.
 * With viewport-based config, this simply returns the viewport dimensions.
 */
export function getSpreadDimensions(
  config: LayoutConfig,
  pixelRatio = 1,
): { width: number; height: number } {
  return {
    width: Math.round(config.viewportWidth * pixelRatio),
    height: Math.round(config.viewportHeight * pixelRatio),
  };
}
