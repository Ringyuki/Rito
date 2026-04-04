import type { LayoutConfig, Page } from '../../layout/core/types';
import type { RenderOptions } from '../core/types';
import { renderBlock } from './block-renderer';
import type { ColorOverride } from './types';

/**
 * Render a page onto a CanvasRenderingContext2D.
 *
 * Draws the page background (if configured), then walks the layout tree
 * and draws each text run and image at its computed position.
 *
 * @param page - The {@link Page} to render.
 * @param ctx - The canvas 2D rendering context.
 * @param config - Page dimensions and margins (used for content offset).
 * @param options - Optional rendering settings (background color, pixel ratio, images).
 */
export function renderPage(
  page: Page,
  ctx: CanvasRenderingContext2D,
  config: LayoutConfig,
  options?: RenderOptions,
): void {
  const pixelRatio = options?.pixelRatio ?? 1;
  const colorOverride = createColorOverride(options);

  ctx.save();
  ctx.scale(pixelRatio, pixelRatio);

  if (options?.backgroundColor) {
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, page.bounds.width, page.bounds.height);
  }

  ctx.beginPath();
  ctx.rect(0, 0, page.bounds.width, page.bounds.height);
  ctx.clip();

  for (const block of page.content) {
    renderBlock(ctx, block, config.marginLeft, config.marginTop, options?.images, colorOverride);
  }

  ctx.restore();
}

function createColorOverride(options?: RenderOptions): ColorOverride | undefined {
  if (!options?.foregroundColor || !options.backgroundColor) return undefined;
  return {
    foregroundColor: options.foregroundColor,
    backgroundColor: options.backgroundColor,
  };
}
