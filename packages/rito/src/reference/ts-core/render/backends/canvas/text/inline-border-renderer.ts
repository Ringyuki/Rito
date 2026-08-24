import type { RunPaint } from '../../../../layout/core/types';
import {
  computeInlineBoxRect,
  type InlineBoxInput,
  type InlineBoxRect,
  traceInlineRoundedRect,
} from './inline-box';

type InlineBorderEdge = NonNullable<NonNullable<RunPaint['border']>['top']>;
type InlineBorderSide = readonly [InlineBorderEdge, number, number, number, number];

/**
 * Draw borders for inline elements. Layout decides which start/end fragments
 * are visible; render only consumes the paint-ready edges.
 */
export function drawInlineBorders(ctx: CanvasRenderingContext2D, fragment: InlineBoxInput): void {
  const border = fragment.paint.border;
  if (!border) return;
  const { top, bottom, start, end } = border;
  if (!top && !bottom && !start && !end) return;

  const rect = computeInlineBoxRect(fragment, ctx);
  const radius = fragment.paint.backgroundRadius ?? 0;
  ctx.save();
  if (top && bottom && start && end && radius > 0) {
    drawRoundedInlineBorders(ctx, rect, radius, getRoundedSides(rect, top, end, bottom, start));
  } else {
    drawStraightInlineBorders(ctx, rect, top, bottom, start, end);
  }
  ctx.restore();
}

function drawRoundedInlineBorders(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  radius: number,
  sides: readonly InlineBorderSide[],
): void {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  for (const side of sides) {
    drawRoundedInlineSide(ctx, side, rect, radius, cx, cy);
  }
}

function getRoundedSides(
  rect: InlineBoxRect,
  top: InlineBorderEdge,
  end: InlineBorderEdge,
  bottom: InlineBorderEdge,
  start: InlineBorderEdge,
): readonly InlineBorderSide[] {
  return [
    [top, rect.x, rect.y, rect.x + rect.width, rect.y],
    [end, rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height],
    [bottom, rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height],
    [start, rect.x, rect.y + rect.height, rect.x, rect.y],
  ];
}

function drawRoundedInlineSide(
  ctx: CanvasRenderingContext2D,
  [edge, x1, y1, x2, y2]: InlineBorderSide,
  rect: InlineBoxRect,
  radius: number,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = edge.paint.color;
  ctx.lineWidth = edge.widthPx;
  ctx.setLineDash([]);
  traceInlineRoundedRect(ctx, rect, radius);
  ctx.stroke();
  ctx.restore();
}

function drawStraightInlineBorders(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  top: InlineBorderEdge | undefined,
  bottom: InlineBorderEdge | undefined,
  start: InlineBorderEdge | undefined,
  end: InlineBorderEdge | undefined,
): void {
  if (top) drawTopBorder(ctx, rect, top);
  if (bottom) drawBottomBorder(ctx, rect, bottom);
  if (start) drawStartBorder(ctx, rect, start);
  if (end) drawEndBorder(ctx, rect, end);
}

function drawTopBorder(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  edge: InlineBorderEdge,
): void {
  drawBorderEdge(
    ctx,
    edge,
    rect.x,
    rect.y + edge.widthPx / 2,
    rect.x + rect.width,
    rect.y + edge.widthPx / 2,
  );
}

function drawBottomBorder(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  edge: InlineBorderEdge,
): void {
  drawBorderEdge(
    ctx,
    edge,
    rect.x,
    rect.y + rect.height - edge.widthPx / 2,
    rect.x + rect.width,
    rect.y + rect.height - edge.widthPx / 2,
  );
}

function drawStartBorder(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  edge: InlineBorderEdge,
): void {
  drawBorderEdge(
    ctx,
    edge,
    rect.x + edge.widthPx / 2,
    rect.y,
    rect.x + edge.widthPx / 2,
    rect.y + rect.height,
  );
}

function drawEndBorder(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  edge: InlineBorderEdge,
): void {
  drawBorderEdge(
    ctx,
    edge,
    rect.x + rect.width - edge.widthPx / 2,
    rect.y,
    rect.x + rect.width - edge.widthPx / 2,
    rect.y + rect.height,
  );
}

function drawBorderEdge(
  ctx: CanvasRenderingContext2D,
  edge: InlineBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.strokeStyle = edge.paint.color;
  ctx.lineWidth = edge.widthPx;
  applyLineDash(ctx, edge);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function applyLineDash(ctx: CanvasRenderingContext2D, edge: InlineBorderEdge): void {
  if (edge.paint.style === 'dotted') {
    ctx.setLineDash([0.001, edge.widthPx * 1.5]);
    ctx.lineCap = 'round';
  } else if (edge.paint.style === 'dashed') {
    ctx.setLineDash([edge.widthPx * 3, edge.widthPx * 2]);
    ctx.lineCap = 'butt';
  } else {
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  }
}
