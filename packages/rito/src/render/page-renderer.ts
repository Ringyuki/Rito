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

  const colorOverride =
    options?.foregroundColor && options.backgroundColor
      ? { foregroundColor: options.foregroundColor, backgroundColor: options.backgroundColor }
      : undefined;

  for (const block of page.content) {
    renderBlock(ctx, block, config.marginLeft, config.marginTop, options?.images, colorOverride);
  }

  ctx.restore();
}

type ColorOverride = { foregroundColor: string; backgroundColor: string };

function renderBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
  colorOverride?: ColorOverride,
): void {
  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;

  if (block.backgroundColor) {
    ctx.fillStyle = block.backgroundColor;
    ctx.fillRect(blockX, blockY, block.bounds.width, block.bounds.height);
  }

  if (block.borders) {
    renderBorders(ctx, block.borders, blockX, blockY, block.bounds.width, block.bounds.height);
  }

  for (const child of block.children) {
    if (child.type === 'line-box') {
      renderLineBox(ctx, child, blockX, blockY, colorOverride);
    } else if (child.type === 'image') {
      renderImage(ctx, child, blockX, blockY, images);
    } else if (child.type === 'hr') {
      renderHorizontalRule(ctx, child, blockX, blockY);
    } else {
      renderBlock(ctx, child, blockX, blockY, images, colorOverride);
    }
  }
}

function renderBorders(
  ctx: CanvasRenderingContext2D,
  borders: NonNullable<LayoutBlock['borders']>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const { top, right, bottom, left } = borders;
  ctx.save();
  if (top.width > 0) strokeLine(ctx, top.color, top.width, x, y + top.width / 2, x + w, y + top.width / 2);
  if (bottom.width > 0) strokeLine(ctx, bottom.color, bottom.width, x, y + h - bottom.width / 2, x + w, y + h - bottom.width / 2);
  if (left.width > 0) strokeLine(ctx, left.color, left.width, x + left.width / 2, y, x + left.width / 2, y + h);
  if (right.width > 0) strokeLine(ctx, right.color, right.width, x + w - right.width / 2, y, x + w - right.width / 2, y + h);
  ctx.restore();
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  color: string, width: number,
  x1: number, y1: number, x2: number, y2: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function renderLineBox(
  ctx: CanvasRenderingContext2D,
  lineBox: LineBox,
  offsetX: number,
  offsetY: number,
  colorOverride?: ColorOverride,
): void {
  const lineX = offsetX + lineBox.bounds.x;
  const lineY = offsetY + lineBox.bounds.y;

  for (const run of lineBox.runs) {
    drawTextRun(ctx, run, lineX, lineY, colorOverride);
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
