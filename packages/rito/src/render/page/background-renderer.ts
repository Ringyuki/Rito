import type { BoxShadow } from '../../style/core/types';
import type { LayoutBlock } from '../../layout/core/types';

export function renderBlockBackground(
  ctx: CanvasRenderingContext2D,
  block: LayoutBlock,
  blockX: number,
  blockY: number,
  radius: number,
): void {
  if (block.boxShadow && block.boxShadow.length > 0) {
    renderBoxShadows(
      ctx,
      block.boxShadow,
      blockX,
      blockY,
      block.bounds.width,
      block.bounds.height,
      radius,
    );
  }

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

/**
 * Render outer box-shadows using the inverse-clip technique:
 * 1. Create a clip that excludes the box interior (evenodd)
 * 2. Set Canvas shadow properties
 * 3. Fill the box path → shadow renders outside, fill is clipped away
 *
 * This works correctly for transparent blocks, border-only blocks, and rounded corners.
 */
function renderBoxShadows(
  ctx: CanvasRenderingContext2D,
  shadows: readonly BoxShadow[],
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  // Render in reverse order (first in list = topmost = rendered last)
  for (let i = shadows.length - 1; i >= 0; i--) {
    const s = shadows[i];
    if (!s || s.inset) continue;
    renderSingleBoxShadow(ctx, s, x, y, w, h, radius);
  }
}

function renderSingleBoxShadow(
  ctx: CanvasRenderingContext2D,
  s: BoxShadow,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  ctx.save();

  // Inverse clip: outer rect CW + inner box CCW → only outside the box is drawable
  const pad = s.blur * 2 + Math.abs(s.offsetX) + Math.abs(s.offsetY) + Math.max(s.spread, 0) + 50;
  ctx.beginPath();
  ctx.rect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  // Trace inner box path in reverse (will be subtracted by evenodd)
  traceBoxPathCCW(ctx, x, y, w, h, radius);
  ctx.clip('evenodd');

  // Set shadow and fill the (spread-expanded) box shape → shadow appears outside
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur;
  ctx.shadowOffsetX = s.offsetX;
  ctx.shadowOffsetY = s.offsetY;
  ctx.fillStyle = s.color;
  const sp = s.spread;
  const expandedW = w + sp * 2;
  const expandedH = h + sp * 2;
  if (expandedW <= 0 || expandedH <= 0) {
    ctx.restore();
    return;
  }
  const expandedR = Math.max(0, radius + sp); // clamp: negative spread can shrink radius below 0
  if (expandedR > 0) {
    traceRoundedRect(ctx, x - sp, y - sp, expandedW, expandedH, expandedR);
  } else {
    ctx.beginPath();
    ctx.rect(x - sp, y - sp, expandedW, expandedH);
  }
  ctx.fill();

  ctx.restore();
}

/** Trace a box path counter-clockwise (for evenodd clip subtraction). */
function traceBoxPathCCW(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  if (radius > 0) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x, y, x, y + h, r);
    ctx.arcTo(x, y + h, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x + w, y, r);
    ctx.arcTo(x + w, y, x, y, r);
  } else {
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y);
  }
  ctx.closePath();
}
