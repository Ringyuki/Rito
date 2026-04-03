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
import { buildHrefResolver } from '../utils/resolve-href';

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

function renderBlockBackground(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  blockX: number,
  blockY: number,
  radius: number,
): void {
  if (block.backgroundColor) {
    ctx.fillStyle = block.backgroundColor;
    if (radius > 0) {
      traceRoundedRect(ctx, blockX, blockY, block.bounds.width, block.bounds.height, radius);
      ctx.fill();
    } else {
      ctx.fillRect(blockX, blockY, block.bounds.width, block.bounds.height);
    }
  }

  if (block.borders) {
    if (radius > 0) {
      renderRoundedBorders(
        ctx,
        block.borders,
        blockX,
        blockY,
        block.bounds.width,
        block.bounds.height,
        radius,
      );
    } else {
      renderBorders(ctx, block.borders, blockX, blockY, block.bounds.width, block.bounds.height);
    }
  }
}

function renderBlock(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
  images?: ReadonlyMap<string, ImageBitmap>,
  colorOverride?: ColorOverride,
): void {
  const offset = block.relativeOffset;
  if (offset) {
    ctx.save();
    ctx.translate(offset.dx, offset.dy);
  }

  const opacityValue = block.opacity;
  const hasOpacity = opacityValue !== undefined && opacityValue < 1;
  if (hasOpacity) {
    ctx.save();
    ctx.globalAlpha = opacityValue;
  }

  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;
  renderBlockBackground(ctx, block, blockX, blockY, block.borderRadius ?? 0);

  const clipping = block.overflow === 'hidden';
  if (clipping) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(blockX, blockY, block.bounds.width, block.bounds.height);
    ctx.clip();
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

  if (clipping) ctx.restore();
  if (hasOpacity) ctx.restore();
  if (offset) ctx.restore();
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
  if (top.width > 0) strokeBorder(ctx, top, x, y + top.width / 2, x + w, y + top.width / 2);
  if (bottom.width > 0)
    strokeBorder(ctx, bottom, x, y + h - bottom.width / 2, x + w, y + h - bottom.width / 2);
  if (left.width > 0) strokeBorder(ctx, left, x + left.width / 2, y, x + left.width / 2, y + h);
  if (right.width > 0)
    strokeBorder(ctx, right, x + w - right.width / 2, y, x + w - right.width / 2, y + h);
  ctx.restore();
}

function strokeBorder(
  ctx: CanvasRenderingContext2D,
  edge: { width: number; color: string; style: 'solid' | 'dotted' | 'dashed' },
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.strokeStyle = edge.color;
  ctx.lineWidth = edge.width;
  ctx.setLineDash(getDashPattern(edge.style, edge.width));
  // Snap to pixel grid for crisp lines (half-pixel offset for odd-width strokes)
  const snap = edge.width % 2 === 1 ? 0.5 : 0;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + snap, Math.round(y1) + snap);
  ctx.lineTo(Math.round(x2) + snap, Math.round(y2) + snap);
  ctx.stroke();
}

function getDashPattern(style: 'solid' | 'dotted' | 'dashed', width: number): number[] {
  if (style === 'dotted') return [width, width];
  if (style === 'dashed') return [width * 3, width * 2];
  return [];
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
  const rawY = offsetY + hr.bounds.y + hr.bounds.height / 2;
  const snap = hr.bounds.height % 2 === 1 ? 0.5 : 0;
  const y = Math.round(rawY) + snap;
  ctx.save();
  ctx.strokeStyle = hr.color;
  ctx.lineWidth = hr.bounds.height;
  ctx.beginPath();
  ctx.moveTo(Math.round(x), y);
  ctx.lineTo(Math.round(x + hr.bounds.width), y);
  ctx.stroke();
  ctx.restore();
}

/** Trace a rounded rectangle path without filling or stroking. */
function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const clampedR = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + clampedR, y);
  ctx.arcTo(x + w, y, x + w, y + h, clampedR);
  ctx.arcTo(x + w, y + h, x, y + h, clampedR);
  ctx.arcTo(x, y + h, x, y, clampedR);
  ctx.arcTo(x, y, x + w, y, clampedR);
  ctx.closePath();
}

/** Stroke a rounded border using a single rounded rect path. */
function renderRoundedBorders(
  ctx: CanvasRenderingContext2D,
  borders: NonNullable<LayoutBlock['borders']>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  // Use the top border's style for the entire rounded border
  const edge = borders.top;
  if (edge.width <= 0) return;
  ctx.save();
  ctx.strokeStyle = edge.color;
  ctx.lineWidth = edge.width;
  ctx.setLineDash(getDashPattern(edge.style, edge.width));
  traceRoundedRect(ctx, x, y, w, h, r);
  ctx.stroke();
  ctx.restore();
}

let cachedResolver: ((src: string) => ImageBitmap | undefined) | undefined;
let cachedImages: ReadonlyMap<string, ImageBitmap> | undefined;

function resolveImageBitmap(
  src: string,
  images: ReadonlyMap<string, ImageBitmap>,
): ImageBitmap | undefined {
  if (images !== cachedImages) {
    cachedResolver = buildHrefResolver(images);
    cachedImages = images;
  }
  return cachedResolver?.(src);
}
