import { traceBoxPathCCW, traceRoundedRect } from '../canvas-path';
import {
  bordersAreUniform,
  getBorderSides,
  hasVisibleBorder,
  resolveRoundedBorderGeometry,
  toRenderBorders,
  type BorderSide,
  type RenderBorderEdge,
  type RenderBorders,
  type RoundedBorderGeometry,
} from './border-model';
import { applyStrokeStyle, strokeBorder } from './border-stroke';
import type { CanvasBlockBorderBox, CanvasBlockBorderPaint } from './types';

export function renderBlockBorders(
  ctx: CanvasRenderingContext2D,
  borderBox: CanvasBlockBorderBox | undefined,
  paint: CanvasBlockBorderPaint | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  const borders = toRenderBorders(borderBox, paint);
  if (!borders) return;
  if (radiusX > 0 || radiusY > 0) {
    renderRoundedBorders(ctx, borders, x, y, width, height, radiusX, radiusY);
    return;
  }
  renderStraightBorders(ctx, borders, x, y, width, height);
}

function renderStraightBorders(
  ctx: CanvasRenderingContext2D,
  borders: RenderBorders,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  // The browser rasters a border box on whole device pixels — each edge
  // rounds independently (measured: a 6px groove at fractional x paints
  // columns [665,671) crisp, where fractional stroking bleeds AA one
  // column each side).
  const right0 = Math.round(x + width);
  const bottom0 = Math.round(y + height);
  x = Math.round(x);
  y = Math.round(y);
  width = right0 - x;
  height = bottom0 - y;
  const { top, right, bottom, left } = borders;
  ctx.save();
  try {
    if (top.width > 0) {
      strokeBorder(ctx, top, x, y + top.width / 2, x + width, y + top.width / 2);
    }
    if (bottom.width > 0) {
      strokeBorder(
        ctx,
        bottom,
        x,
        y + height - bottom.width / 2,
        x + width,
        y + height - bottom.width / 2,
      );
    }
    if (left.width > 0) {
      strokeBorder(ctx, left, x + left.width / 2, y, x + left.width / 2, y + height);
    }
    if (right.width > 0) {
      strokeBorder(
        ctx,
        right,
        x + width - right.width / 2,
        y,
        x + width - right.width / 2,
        y + height,
      );
    }
  } finally {
    ctx.restore();
  }
}

function renderRoundedBorders(
  ctx: CanvasRenderingContext2D,
  borders: RenderBorders,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  if (!hasVisibleBorder(borders)) return;
  if (bordersAreUniform(borders)) {
    renderUniformRoundedBorder(ctx, borders.top, x, y, width, height, radiusX, radiusY);
    return;
  }
  const geometry = resolveRoundedBorderGeometry(borders, x, y, width, height, radiusX, radiusY);
  for (const side of getBorderSides(borders, geometry)) {
    renderRoundedBorderSide(ctx, side, geometry);
  }
}

function renderUniformRoundedBorder(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): void {
  ctx.save();
  try {
    // The border ink lives INSIDE the border box: the stroke centerline
    // sits half a width in from the rounded outer path, matching the
    // straight-edge path (which insets by width/2) and Blink's ink span
    // from the border-box edge to the padding-box edge. Stroking the
    // outer path itself hung half the ink outside the box and lit every
    // bubble outline up as a shifted ring (b52 Next-w).
    if (edge.style === 'double') {
      // Blink's double: two lines of a third each, a third of gap — the
      // outer line's centerline sits width/6 in from the outer path, the
      // inner line's width/6 out from the padding path.
      const third = edge.width / 3;
      applyStrokeStyle(ctx, { ...edge, width: third });
      for (const inset of [third / 2, edge.width - third / 2]) {
        traceRoundedRect(
          ctx,
          x + inset,
          y + inset,
          width - 2 * inset,
          height - 2 * inset,
          Math.max(0, radiusX - inset),
          Math.max(0, radiusY - inset),
        );
        ctx.stroke();
      }
      return;
    }
    const inset = edge.width / 2;
    applyStrokeStyle(ctx, edge);
    traceRoundedRect(
      ctx,
      x + inset,
      y + inset,
      width - 2 * inset,
      height - 2 * inset,
      Math.max(0, radiusX - inset),
      Math.max(0, radiusY - inset),
    );
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

function renderRoundedBorderSide(
  ctx: CanvasRenderingContext2D,
  side: BorderSide,
  geometry: RoundedBorderGeometry,
): void {
  const [edge] = side;
  if (edge.width <= 0) return;
  ctx.save();
  try {
    clipBorderSide(ctx, side, geometry);
    if (edge.style !== 'solid') drawStyledRoundedStroke(ctx, edge, geometry);
    else fillSolidRoundedSide(ctx, edge, geometry);
  } finally {
    ctx.restore();
  }
}

function clipBorderSide(
  ctx: CanvasRenderingContext2D,
  [, x1, y1, x2, y2]: BorderSide,
  geometry: RoundedBorderGeometry,
): void {
  ctx.beginPath();
  ctx.moveTo(geometry.centerX, geometry.centerY);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();
}

function drawStyledRoundedStroke(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  geometry: RoundedBorderGeometry,
): void {
  applyStrokeStyle(ctx, edge);
  traceRoundedRect(
    ctx,
    geometry.x,
    geometry.y,
    geometry.width,
    geometry.height,
    geometry.cornerRadiusX,
    geometry.cornerRadiusY,
  );
  ctx.stroke();
}

function fillSolidRoundedSide(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  geometry: RoundedBorderGeometry,
): void {
  ctx.fillStyle = edge.color;
  ctx.beginPath();
  traceRoundedRect(
    ctx,
    geometry.x,
    geometry.y,
    geometry.width,
    geometry.height,
    geometry.cornerRadiusX,
    geometry.cornerRadiusY,
  );
  if (geometry.innerWidth > 0 && geometry.innerHeight > 0) {
    traceBoxPathCCW(
      ctx,
      geometry.innerX,
      geometry.innerY,
      geometry.innerWidth,
      geometry.innerHeight,
      geometry.innerRadiusX,
      geometry.innerRadiusY,
    );
  }
  ctx.fill('evenodd');
}
