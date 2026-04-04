import type { LayoutBlock } from '../../layout/types';

export function renderBlockBackground(
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

  if (!block.borders) return;
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
    return;
  }
  renderBorders(ctx, block.borders, blockX, blockY, block.bounds.width, block.bounds.height);
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
  if (bottom.width > 0) {
    strokeBorder(ctx, bottom, x, y + h - bottom.width / 2, x + w, y + h - bottom.width / 2);
  }
  if (left.width > 0) strokeBorder(ctx, left, x + left.width / 2, y, x + left.width / 2, y + h);
  if (right.width > 0) {
    strokeBorder(ctx, right, x + w - right.width / 2, y, x + w - right.width / 2, y + h);
  }
  ctx.restore();
}

function renderRoundedBorders(
  ctx: CanvasRenderingContext2D,
  borders: NonNullable<LayoutBlock['borders']>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
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

function traceRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const clampedRadius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + clampedRadius, y);
  ctx.arcTo(x + w, y, x + w, y + h, clampedRadius);
  ctx.arcTo(x + w, y + h, x, y + h, clampedRadius);
  ctx.arcTo(x, y + h, x, y, clampedRadius);
  ctx.arcTo(x, y, x + w, y, clampedRadius);
  ctx.closePath();
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
