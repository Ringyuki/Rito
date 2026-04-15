import type { LayoutConfig, Spread } from '../../layout/core/types';
import type { RenderOptions } from '../core/types';
import { renderPage } from '../page';
import { resolveSpreadBodyBackground } from './spread-background';

/**
 * Render a spread onto a CanvasRenderingContext2D.
 *
 * Renders a single-page or two-page spread onto the canvas.
 *
 * The canvas should be sized to `viewportWidth × viewportHeight` (× pixelRatio).
 */
/**
 * Accepts OffscreenCanvasRenderingContext2D via the union type.
 * Internally cast to CanvasRenderingContext2D for downstream functions —
 * both context types are structurally compatible for all 2D drawing operations used.
 */
export function render(
  spread: Spread,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  config: LayoutConfig,
  options?: RenderOptions,
): void {
  const pixelRatio = options?.pixelRatio ?? 1;

  // 1. Fill entire viewport with reader theme background
  if (options?.backgroundColor) {
    ctx.save();
    ctx.scale(pixelRatio, pixelRatio);
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, config.viewportWidth, config.viewportHeight);
    ctx.restore();
  }

  // 2. If there's a unified body bg across the spread, fill the ENTIRE viewport
  //    with it before rendering pages. This covers both pages + the gap between
  //    them in one pass, avoiding sub-pixel seams from separate fills.
  const bodyBg = resolveSpreadBodyBackground(spread, config);
  if (bodyBg) {
    ctx.save();
    ctx.scale(pixelRatio, pixelRatio);
    ctx.fillStyle = bodyBg;
    ctx.fillRect(0, 0, config.viewportWidth, config.viewportHeight);
    ctx.restore();
  }

  // 3. Render pages. When the spread has a unified body bg, pass it via
  //    spreadBodyBg so renderPage skips redundant per-page background fills.
  const pageOptions: RenderOptions | undefined = bodyBg
    ? { ...options, spreadBodyBg: bodyBg }
    : options;
  const drawCtx = ctx as CanvasRenderingContext2D;
  if (spread.left) {
    ctx.save();
    ctx.translate(0, 0);
    renderPage(spread.left, drawCtx, config, pageOptions);
    ctx.restore();
  }

  if (config.spreadMode === 'double' && spread.right) {
    const offsetX = Math.round((config.pageWidth + config.spreadGap) * pixelRatio);
    ctx.save();
    ctx.translate(offsetX, 0);
    renderPage(spread.right, drawCtx, config, pageOptions);
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
    width: Math.round(config.viewportWidth * pixelRatio),
    height: Math.round(config.viewportHeight * pixelRatio),
  };
}
