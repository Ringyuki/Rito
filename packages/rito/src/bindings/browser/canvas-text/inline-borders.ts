import { computeInlineBoxRect, traceInlineRoundedRect } from './inline-box';
import type { CanvasInlineBorderEdge, CanvasTextFragment } from './types';

type InlineFragment = Pick<CanvasTextFragment, 'rect' | 'paint'>;
type InlineBoxRect = CanvasTextFragment['rect'];
type InlineBorderSide = readonly [CanvasInlineBorderEdge, number, number, number, number];

/** Draw the paint-ready border edges for an inline fragment. */
export function drawInlineBorders(ctx: CanvasRenderingContext2D, fragment: InlineFragment): void {
  const border = fragment.paint.border;
  if (!border) return;
  const { top, bottom, start, end } = border;
  if (!top && !bottom && !start && !end) return;

  const rect = computeInlineBoxRect(fragment, ctx);
  const radius = fragment.paint.backgroundRadius ?? 0;
  ctx.save();
  try {
    if (top && bottom && start && end && radius > 0) {
      drawRoundedInlineBorders(ctx, rect, radius, getRoundedSides(rect, top, end, bottom, start));
    } else {
      drawStraightInlineBorders(ctx, rect, top, bottom, start, end);
    }
  } finally {
    ctx.restore();
  }
}

function drawRoundedInlineBorders(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  radius: number,
  sides: readonly InlineBorderSide[],
): void {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  for (const side of sides) {
    drawRoundedInlineSide(ctx, side, rect, radius, centerX, centerY);
  }
}

function getRoundedSides(
  rect: InlineBoxRect,
  top: CanvasInlineBorderEdge,
  end: CanvasInlineBorderEdge,
  bottom: CanvasInlineBorderEdge,
  start: CanvasInlineBorderEdge,
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
  centerX: number,
  centerY: number,
): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = edge.paint.color;
    ctx.lineWidth = edge.widthPx;
    ctx.setLineDash([]);
    traceInlineRoundedRect(ctx, rect, radius);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

function drawStraightInlineBorders(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  top: CanvasInlineBorderEdge | undefined,
  bottom: CanvasInlineBorderEdge | undefined,
  start: CanvasInlineBorderEdge | undefined,
  end: CanvasInlineBorderEdge | undefined,
): void {
  if (top) drawTopBorder(ctx, rect, top);
  if (bottom) drawBottomBorder(ctx, rect, bottom);
  if (start) drawStartBorder(ctx, rect, start);
  if (end) drawEndBorder(ctx, rect, end);
}

function drawTopBorder(
  ctx: CanvasRenderingContext2D,
  rect: InlineBoxRect,
  edge: CanvasInlineBorderEdge,
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
  edge: CanvasInlineBorderEdge,
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
  edge: CanvasInlineBorderEdge,
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
  edge: CanvasInlineBorderEdge,
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
  edge: CanvasInlineBorderEdge,
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

function applyLineDash(ctx: CanvasRenderingContext2D, edge: CanvasInlineBorderEdge): void {
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
