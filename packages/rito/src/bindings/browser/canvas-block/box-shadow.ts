import { traceBoxPathCCW, traceRoundedRect } from '../canvas-path';
import type { CanvasBlockBoxShadow } from './types';

/** Render outer box shadows with an even-odd clip excluding the box interior. */
export function renderBoxShadows(
  ctx: CanvasRenderingContext2D,
  shadows: readonly CanvasBlockBoxShadow[],
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number = radiusX,
): void {
  for (let index = shadows.length - 1; index >= 0; index -= 1) {
    const shadow = shadows[index];
    if (!shadow || shadow.inset) continue;
    renderSingleBoxShadow(ctx, shadow, x, y, width, height, radiusX, radiusY);
  }
}

function renderSingleBoxShadow(
  ctx: CanvasRenderingContext2D,
  shadow: CanvasBlockBoxShadow,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  ctx.save();
  try {
    clipOutsideBox(ctx, shadow, x, y, width, height, radiusX, radiusY);
    applyCanvasShadow(ctx, shadow);
    fillExpandedShadowShape(ctx, shadow, x, y, width, height, radiusX, radiusY);
  } finally {
    ctx.restore();
  }
}

function clipOutsideBox(
  ctx: CanvasRenderingContext2D,
  shadow: CanvasBlockBoxShadow,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  const padding =
    shadow.blur * 2 +
    Math.abs(shadow.offsetX) +
    Math.abs(shadow.offsetY) +
    Math.max(shadow.spread, 0) +
    50;
  ctx.beginPath();
  ctx.rect(x - padding, y - padding, width + padding * 2, height + padding * 2);
  traceBoxPathCCW(ctx, x, y, width, height, radiusX, radiusY);
  ctx.clip('evenodd');
}

function applyCanvasShadow(ctx: CanvasRenderingContext2D, shadow: CanvasBlockBoxShadow): void {
  const pixelRatio = ctx.getTransform().a || 1;
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * pixelRatio;
  ctx.shadowOffsetX = shadow.offsetX * pixelRatio;
  ctx.shadowOffsetY = shadow.offsetY * pixelRatio;
  ctx.fillStyle = shadow.color;
}

function fillExpandedShadowShape(
  ctx: CanvasRenderingContext2D,
  shadow: CanvasBlockBoxShadow,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  const spread = shadow.spread;
  const expandedWidth = width + spread * 2;
  const expandedHeight = height + spread * 2;
  if (expandedWidth <= 0 || expandedHeight <= 0) return;
  const expandedRadiusX = Math.max(0, radiusX + spread);
  const expandedRadiusY = Math.max(0, radiusY + spread);
  if (expandedRadiusX > 0 || expandedRadiusY > 0) {
    traceRoundedRect(
      ctx,
      x - spread,
      y - spread,
      expandedWidth,
      expandedHeight,
      expandedRadiusX,
      expandedRadiusY,
    );
  } else {
    ctx.beginPath();
    ctx.rect(x - spread, y - spread, expandedWidth, expandedHeight);
  }
  ctx.fill();
}
