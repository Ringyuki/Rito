import type { LayoutConfig, Spread } from '../layout/types';
import type { RenderOptions } from './types';
import { renderPage } from './page-renderer';

/**
 * Render a spread onto a CanvasRenderingContext2D.
 *
 * This is the primary render function. Handles both single-page and
 * two-page spreads transparently. Size the canvas with {@link getSpreadDimensions}.
 */
export function render(
  spread: Spread,
  ctx: CanvasRenderingContext2D,
  config: LayoutConfig,
  options?: RenderOptions,
): void {
  const pixelRatio = options?.pixelRatio ?? 1;

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
 * Compute the canvas dimensions needed for a spread.
 */
export function getSpreadDimensions(
  config: LayoutConfig,
  pixelRatio = 1,
): { width: number; height: number } {
  const pageW = config.pageWidth * pixelRatio;
  const pageH = config.pageHeight * pixelRatio;

  if (config.spreadMode === 'single') {
    return { width: pageW, height: pageH };
  }

  const gap = config.spreadGap * pixelRatio;
  return { width: pageW * 2 + gap, height: pageH };
}
