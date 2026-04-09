import type { LayoutConfig, Spread } from '../../layout/core/types';
import type { RenderOptions } from '../core/types';
import { renderPage } from '../page';

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

  // 2. Render pages — cast to CanvasRenderingContext2D for downstream compatibility.
  // OffscreenCanvasRenderingContext2D is structurally identical for all drawing ops used.
  const drawCtx = ctx as CanvasRenderingContext2D;
  if (spread.left) {
    ctx.save();
    ctx.translate(0, 0);
    renderPage(spread.left, drawCtx, config, options);
    ctx.restore();
  }

  if (config.spreadMode === 'double' && spread.right) {
    const offsetX = Math.round((config.pageWidth + config.spreadGap) * pixelRatio);
    ctx.save();
    ctx.translate(offsetX, 0);
    renderPage(spread.right, drawCtx, config, options);
    ctx.restore();
  }

  // 3. Fill gap between pages if both share the same body background
  if (config.spreadMode === 'double' && config.spreadGap > 0) {
    const leftBg = spread.left?.bodyBackgroundColor;
    const rightBg = spread.right?.bodyBackgroundColor;
    if (leftBg && leftBg === rightBg) {
      ctx.save();
      ctx.scale(pixelRatio, pixelRatio);
      ctx.fillStyle = leftBg;
      const gapX = config.pageWidth;
      ctx.fillRect(gapX, 0, config.spreadGap, config.viewportHeight);
      ctx.restore();
    }
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
