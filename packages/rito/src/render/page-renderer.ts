import type {
  HorizontalRule,
  ImageElement,
  LayoutBlock,
  LayoutConfig,
  LineBox,
  Page,
} from '../layout/types';
import type { RenderOptions } from './types';
import { drawTextRun } from './text-renderer';

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
    renderBlock(ctx, block, config.marginLeft, config.marginTop, options?.images);
  }

  ctx.restore();
}

function renderBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
): void {
  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;

  if (block.backgroundColor) {
    ctx.fillStyle = block.backgroundColor;
    ctx.fillRect(blockX, blockY, block.bounds.width, block.bounds.height);
  }

  if (block.borders) {
    const { top, right, bottom, left } = block.borders;
    const bx = blockX;
    const by = blockY;
    const bw = block.bounds.width;
    const bh = block.bounds.height;
    ctx.save();
    if (top.width > 0) {
      ctx.strokeStyle = top.color;
      ctx.lineWidth = top.width;
      ctx.beginPath();
      ctx.moveTo(bx, by + top.width / 2);
      ctx.lineTo(bx + bw, by + top.width / 2);
      ctx.stroke();
    }
    if (bottom.width > 0) {
      ctx.strokeStyle = bottom.color;
      ctx.lineWidth = bottom.width;
      ctx.beginPath();
      ctx.moveTo(bx, by + bh - bottom.width / 2);
      ctx.lineTo(bx + bw, by + bh - bottom.width / 2);
      ctx.stroke();
    }
    if (left.width > 0) {
      ctx.strokeStyle = left.color;
      ctx.lineWidth = left.width;
      ctx.beginPath();
      ctx.moveTo(bx + left.width / 2, by);
      ctx.lineTo(bx + left.width / 2, by + bh);
      ctx.stroke();
    }
    if (right.width > 0) {
      ctx.strokeStyle = right.color;
      ctx.lineWidth = right.width;
      ctx.beginPath();
      ctx.moveTo(bx + bw - right.width / 2, by);
      ctx.lineTo(bx + bw - right.width / 2, by + bh);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const child of block.children) {
    if (child.type === 'line-box') {
      renderLineBox(ctx, child, blockX, blockY);
    } else if (child.type === 'image') {
      renderImage(ctx, child, blockX, blockY, images);
    } else if (child.type === 'hr') {
      renderHorizontalRule(ctx, child, blockX, blockY);
    } else {
      renderBlock(ctx, child, blockX, blockY, images);
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

function renderImage(
  ctx: CanvasRenderingContext2D,
  image: ImageElement,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
): void {
  if (!images) return;

  // Resolve src — try direct match, then filename match
  const bitmap = resolveImageBitmap(image.src, images);
  if (!bitmap) return;

  const x = offsetX + image.bounds.x;
  const y = offsetY + image.bounds.y;
  ctx.drawImage(bitmap, x, y, image.bounds.width, image.bounds.height);
}

function renderHorizontalRule(
  ctx: CanvasRenderingContext2D,
  hr: HorizontalRule,
  offsetX: number,
  offsetY: number,
): void {
  const x = offsetX + hr.bounds.x;
  const y = offsetY + hr.bounds.y + hr.bounds.height / 2;
  ctx.save();
  ctx.strokeStyle = hr.color;
  ctx.lineWidth = hr.bounds.height;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + hr.bounds.width, y);
  ctx.stroke();
  ctx.restore();
}

function resolveImageBitmap(
  src: string,
  images: ReadonlyMap<string, ImageBitmap>,
): ImageBitmap | undefined {
  // Direct match
  for (const [href, bitmap] of images) {
    if (src.endsWith(href) || href.endsWith(src)) return bitmap;
  }
  // Filename match
  const srcName = src.split('/').pop();
  if (srcName) {
    for (const [href, bitmap] of images) {
      if (href.split('/').pop() === srcName) return bitmap;
    }
  }
  return undefined;
}
