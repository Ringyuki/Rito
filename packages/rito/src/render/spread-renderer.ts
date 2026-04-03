import type { LayoutConfig, Spread } from '../layout/types';
import type { RenderOptions } from './types';
import { renderPage } from './page-renderer';

/**
 * Render a spread onto a CanvasRenderingContext2D.
 *
 * Renders a single-page or two-page spread onto the canvas.
 *
 * The canvas should be sized to `viewportWidth × viewportHeight` (× pixelRatio).
 */
export function render(
  spread: Spread,
  ctx: CanvasRenderingContext2D,
  config: LayoutConfig,
  options?: RenderOptions,
): void {
  const pixelRatio = options?.pixelRatio ?? 1;

  // Fill the entire viewport (including spread gap) with background color
  if (options?.backgroundColor) {
    ctx.save();
    ctx.scale(pixelRatio, pixelRatio);
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, config.viewportWidth, config.viewportHeight);
    ctx.restore();
  }

  if (spread.left) {
    ctx.save();
    ctx.translate(0, 0);
    renderPage(spread.left, ctx, config, options);
    ctx.restore();
  }

  if (config.spreadMode === 'double' && spread.right) {
    const offsetX = (config.pageWidth + config.spreadGap) * pixelRatio;
    ctx.save();
    ctx.translate(offsetX, 0);
    renderPage(spread.right, ctx, config, options);
    ctx.restore();
  }
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
    width: config.viewportWidth * pixelRatio,
    height: config.viewportHeight * pixelRatio,
  };
}
