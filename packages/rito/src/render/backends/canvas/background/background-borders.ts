import type { BlockBorderPaint, BorderBox } from '../../../../layout/core/types';
import type { BorderPaintEdge } from '../../../../style/core/paint-types';
import { traceBoxPathCCW, traceRoundedRect } from './background-paths';

interface RenderBorderEdge {
  readonly width: number;
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed';
}

interface RenderBorders {
  readonly top: RenderBorderEdge;
  readonly right: RenderBorderEdge;
  readonly bottom: RenderBorderEdge;
  readonly left: RenderBorderEdge;
}

interface RoundedBorderGeometry {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly crx: number;
  readonly cry: number;
  readonly ix: number;
  readonly iy: number;
  readonly iw: number;
  readonly ih: number;
  readonly irx: number;
  readonly iry: number;
  readonly cx: number;
  readonly cy: number;
}

type BorderSide = readonly [RenderBorderEdge, number, number, number, number];

const ZERO_EDGE: RenderBorderEdge = { width: 0, color: '#000', style: 'solid' };

export function renderBlockBorders(
  ctx: CanvasRenderingContext2D,
  borderBox: BorderBox | undefined,
  paint: BlockBorderPaint | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  const borders = toRenderBorders(borderBox, paint);
  if (!borders) return;
  if (rx > 0 || ry > 0) {
    renderRoundedBorders(ctx, borders, x, y, w, h, rx, ry);
    return;
  }
  renderStraightBorders(ctx, borders, x, y, w, h);
}

function toRenderBorders(
  borderBox: BorderBox | undefined,
  paint: BlockBorderPaint | undefined,
): RenderBorders | undefined {
  if (!borderBox && !paint) return undefined;
  return {
    top: toEdge(borderBox?.topWidth, paint?.top),
    right: toEdge(borderBox?.rightWidth, paint?.right),
    bottom: toEdge(borderBox?.bottomWidth, paint?.bottom),
    left: toEdge(borderBox?.leftWidth, paint?.left),
  };
}

function toEdge(width: number | undefined, paint: BorderPaintEdge | undefined): RenderBorderEdge {
  if (width === undefined || width <= 0 || !paint) return ZERO_EDGE;
  return { width, color: paint.color, style: paint.style };
}

function renderStraightBorders(
  ctx: CanvasRenderingContext2D,
  borders: RenderBorders,
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
  borders: RenderBorders,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  if (!hasVisibleBorder(borders)) return;
  if (bordersAreUniform(borders)) {
    renderUniformRoundedBorder(ctx, borders.top, x, y, w, h, rx, ry);
    return;
  }
  renderSplitRoundedBorders(
    ctx,
    borders,
    resolveRoundedBorderGeometry(borders, x, y, w, h, rx, ry),
  );
}

function hasVisibleBorder({ top, right, bottom, left }: RenderBorders): boolean {
  return top.width > 0 || right.width > 0 || bottom.width > 0 || left.width > 0;
}

function bordersAreUniform({ top, right, bottom, left }: RenderBorders): boolean {
  return (
    top.width === right.width &&
    right.width === bottom.width &&
    bottom.width === left.width &&
    top.color === right.color &&
    right.color === bottom.color &&
    bottom.color === left.color &&
    top.style === right.style &&
    right.style === bottom.style &&
    bottom.style === left.style
  );
}

function renderUniformRoundedBorder(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): void {
  ctx.save();
  applyStrokeStyle(ctx, edge);
  traceRoundedRect(ctx, x, y, w, h, rx, ry);
  ctx.stroke();
  ctx.restore();
}

function resolveRoundedBorderGeometry(
  borders: RenderBorders,
  x: number,
  y: number,
  w: number,
  h: number,
  rx: number,
  ry: number,
): RoundedBorderGeometry {
  const { top, right, bottom, left } = borders;
  const crx = Math.min(rx, w / 2);
  const cry = Math.min(ry, h / 2);
  const maxBorder = Math.max(top.width, right.width, bottom.width, left.width);
  return {
    x,
    y,
    w,
    h,
    crx,
    cry,
    ix: x + left.width,
    iy: y + top.width,
    iw: w - left.width - right.width,
    ih: h - top.width - bottom.width,
    irx: Math.max(0, crx - maxBorder),
    iry: Math.max(0, cry - maxBorder),
    cx: x + w / 2,
    cy: y + h / 2,
  };
}

function renderSplitRoundedBorders(
  ctx: CanvasRenderingContext2D,
  borders: RenderBorders,
  geometry: RoundedBorderGeometry,
): void {
  for (const side of getBorderSides(borders, geometry)) {
    renderRoundedBorderSide(ctx, side, geometry);
  }
}

function getBorderSides(borders: RenderBorders, g: RoundedBorderGeometry): readonly BorderSide[] {
  const { top, right, bottom, left } = borders;
  return [
    [top, g.x, g.y, g.x + g.w, g.y],
    [right, g.x + g.w, g.y, g.x + g.w, g.y + g.h],
    [bottom, g.x + g.w, g.y + g.h, g.x, g.y + g.h],
    [left, g.x, g.y + g.h, g.x, g.y],
  ];
}

function renderRoundedBorderSide(
  ctx: CanvasRenderingContext2D,
  side: BorderSide,
  geometry: RoundedBorderGeometry,
): void {
  const [edge] = side;
  if (edge.width <= 0) return;
  ctx.save();
  clipBorderSide(ctx, side, geometry);
  if (edge.style !== 'solid') {
    drawStyledRoundedStroke(ctx, edge, geometry);
  } else {
    fillSolidRoundedSide(ctx, edge, geometry);
  }
  ctx.restore();
}

function clipBorderSide(
  ctx: CanvasRenderingContext2D,
  [, x1, y1, x2, y2]: BorderSide,
  { cx, cy }: RoundedBorderGeometry,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();
}

function drawStyledRoundedStroke(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  { x, y, w, h, crx, cry }: RoundedBorderGeometry,
): void {
  applyStrokeStyle(ctx, edge);
  traceRoundedRect(ctx, x, y, w, h, crx, cry);
  ctx.stroke();
}

function fillSolidRoundedSide(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  { x, y, w, h, crx, cry, ix, iy, iw, ih, irx, iry }: RoundedBorderGeometry,
): void {
  ctx.fillStyle = edge.color;
  ctx.beginPath();
  traceRoundedRect(ctx, x, y, w, h, crx, cry);
  if (iw > 0 && ih > 0) {
    traceBoxPathCCW(ctx, ix, iy, iw, ih, irx, iry);
  }
  ctx.fill('evenodd');
}

function strokeBorder(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  applyStrokeStyle(ctx, edge);
  const snap = edge.width % 2 === 1 ? 0.5 : 0;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + snap, Math.round(y1) + snap);
  ctx.lineTo(Math.round(x2) + snap, Math.round(y2) + snap);
  ctx.stroke();
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D, edge: RenderBorderEdge): void {
  ctx.strokeStyle = edge.color;
  if (edge.style === 'dotted') {
    const dotWidth = edge.width * 0.75;
    ctx.lineWidth = dotWidth;
    ctx.setLineDash([0.001, edge.width * 1.5]);
    ctx.lineCap = 'round';
    return;
  }
  ctx.lineWidth = edge.width;
  ctx.setLineDash(getDashPattern(edge.style, edge.width));
  ctx.lineCap = 'butt';
}

function getDashPattern(style: 'solid' | 'dotted' | 'dashed', width: number): number[] {
  if (style === 'dotted') return [0.001, width * 1.5];
  if (style === 'dashed') return [width * 3, width * 2];
  return [];
}
