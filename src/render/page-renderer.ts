import type { LayoutBlock, LayoutConfig, LineBox, Page } from '../layout/types';
import type { RenderOptions } from './types';
import { drawTextRun } from './text-renderer';

/**
 * Render a page onto a CanvasRenderingContext2D.
 *
 * Draws the page background (if configured), then walks the layout tree
 * and draws each text run at its computed position, offset by page margins.
 *
 * The canvas element should be sized to `page.bounds.width * pixelRatio` by
 * `page.bounds.height * pixelRatio`. This function applies `ctx.scale()` to
 * handle the pixel ratio internally.
 *
 * @param page - The {@link Page} to render.
 * @param ctx - The canvas 2D rendering context.
 * @param config - Page dimensions and margins (used for content offset).
 * @param options - Optional rendering settings (background color, pixel ratio).
 *
 * @example
 * ```ts
 * const ctx = canvas.getContext('2d')!;
 * renderPage(pages[0], ctx, config, { backgroundColor: '#ffffff' });
 * ```
 */
export function renderPage(
  page: Page,
  ctx: CanvasRenderingContext2D,
  config: LayoutConfig,
  options?: RenderOptions,
): void {
  const pixelRatio = options?.pixelRatio ?? 1;

  ctx.save();
  ctx.scale(pixelRatio, pixelRatio);

  if (options?.backgroundColor) {
    ctx.fillStyle = options.backgroundColor;
    ctx.fillRect(0, 0, page.bounds.width, page.bounds.height);
  }

  for (const block of page.content) {
    renderBlock(ctx, block, config.marginLeft, config.marginTop);
  }

  ctx.restore();
}

function renderBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
): void {
  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;

  for (const child of block.children) {
    if (child.type === 'line-box') {
      renderLineBox(ctx, child, blockX, blockY);
    } else {
      renderBlock(ctx, child, blockX, blockY);
    }
  }
}

function renderLineBox(
  ctx: CanvasRenderingContext2D,
  lineBox: LineBox,
  offsetX: number,
  offsetY: number,
): void {
  const lineX = offsetX + lineBox.bounds.x;
  const lineY = offsetY + lineBox.bounds.y;

  for (const run of lineBox.runs) {
    drawTextRun(ctx, run, lineX, lineY);
  }
}
