import type { BoxShadow } from '../../style/core/types';
import { traceBoxPathCCW, traceRoundedRect } from './background-paths';

/**
 * Render outer box-shadows using the inverse-clip technique:
 * 1. Create a clip that excludes the box interior (evenodd)
 * 2. Set Canvas shadow properties
 * 3. Fill the box path, leaving only the outside shadow visible
 */
export function renderBoxShadows(
  ctx: CanvasRenderingContext2D,
  shadows: readonly BoxShadow[],
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number = rx,
): void {
  for (let i = shadows.length - 1; i >= 0; i--) {
    const shadow = shadows[i];
    if (!shadow || shadow.inset) continue;
    renderSingleBoxShadow(ctx, shadow, x, y, w, h, rx, ry);
  }
}

function renderSingleBoxShadow(
  ctx: CanvasRenderingContext2D,
  shadow: BoxShadow,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  ctx.save();
  clipOutsideBox(ctx, shadow, x, y, w, h, rx, ry);
  applyCanvasShadow(ctx, shadow);
  fillExpandedShadowShape(ctx, shadow, x, y, w, h, rx, ry);
  ctx.restore();
}

function clipOutsideBox(
  ctx: CanvasRenderingContext2D,
  shadow: BoxShadow,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  const pad =
    shadow.blur * 2 +
    Math.abs(shadow.offsetX) +
    Math.abs(shadow.offsetY) +
    Math.max(shadow.spread, 0) +
    50;
  ctx.beginPath();
  ctx.rect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  traceBoxPathCCW(ctx, x, y, w, h, rx, ry);
  ctx.clip('evenodd');
}

function applyCanvasShadow(ctx: CanvasRenderingContext2D, shadow: BoxShadow): void {
  const dpr = ctx.getTransform().a || 1;
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * dpr;
  ctx.shadowOffsetX = shadow.offsetX * dpr;
  ctx.shadowOffsetY = shadow.offsetY * dpr;
  ctx.fillStyle = shadow.color;
}

function fillExpandedShadowShape(
  ctx: CanvasRenderingContext2D,
  shadow: BoxShadow,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  const sp = shadow.spread;
  const expandedW = w + sp * 2;
  const expandedH = h + sp * 2;
  if (expandedW <= 0 || expandedH <= 0) return;
  const expandedRx = Math.max(0, rx + sp);
  const expandedRy = Math.max(0, ry + sp);
  if (expandedRx > 0 || expandedRy > 0) {
    traceRoundedRect(ctx, x - sp, y - sp, expandedW, expandedH, expandedRx, expandedRy);
  } else {
    ctx.beginPath();
    ctx.rect(x - sp, y - sp, expandedW, expandedH);
  }
  ctx.fill();
}
