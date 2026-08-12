import type { BlockBorderPaint, BorderBox } from '../../../../layout/core/types';
import type { BorderPaintEdge } from '../../../../style/core/paint-types';
import { traceBoxPathCCW, traceRoundedRect } from './background-paths';

interface RenderBorderEdge {
  readonly width: number;
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed' | 'double';
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
  // Ink lives INSIDE the border box (centerline half a width in from the
  // rounded outer path); double = two third-width lines with a third of
  // gap — both mirror the production pen.
  if (edge.style === 'double') {
    const third = edge.width / 3;
    applyStrokeStyle(ctx, { ...edge, width: third });
    for (const inset of [third / 2, edge.width - third / 2]) {
      traceRoundedRect(
        ctx,
        x + inset,
        y + inset,
        w - 2 * inset,
        h - 2 * inset,
        Math.max(0, rx - inset),
        Math.max(0, ry - inset),
      );
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const inset = edge.width / 2;
  applyStrokeStyle(ctx, edge);
  traceRoundedRect(
    ctx,
    x + inset,
    y + inset,
    w - 2 * inset,
    h - 2 * inset,
    Math.max(0, rx - inset),
    Math.max(0, ry - inset),
  );
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

export function strokeBorder(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  if (
    edge.style === 'dotted' &&
    (edge.width === 1 || edge.width === 2) &&
    (x1 === x2 || y1 === y2)
  ) {
    strokeBinaryDotted(ctx, edge, x1, y1, x2, y2);
    return;
  }
  // Blink's double border: two lines of a third each with a third of
  // gap around the handed centerline (mirrors the production pen).
  if (edge.style === 'double' && (x1 === x2 || y1 === y2)) {
    const third = edge.width / 3;
    const line: RenderBorderEdge = { ...edge, width: third, style: 'solid' };
    if (y1 === y2) {
      strokeBorder(ctx, line, x1, y1 - third, x2, y2 - third);
      strokeBorder(ctx, line, x1, y1 + third, x2, y2 + third);
    } else {
      strokeBorder(ctx, line, x1 - third, y1, x2 - third, y2);
      strokeBorder(ctx, line, x1 + third, y1, x2 + third, y2);
    }
    return;
  }
  applyStrokeStyle(ctx, edge);
  const snap = edge.width % 2 === 1 ? 0.5 : 0;
  ctx.beginPath();
  ctx.moveTo(Math.round(x1) + snap, Math.round(y1) + snap);
  ctx.lineTo(Math.round(x2) + snap, Math.round(y2) + snap);
  ctx.stroke();
}

// Thin dotted edges raster as BINARY square dots of side = the border
// width: one dot anchors at the start, the rest at the end every
// 2×width, the first interval absorbing the parity remainder (mirrors
// the production pen — both pens change together).
function strokeBinaryDotted(
  ctx: CanvasRenderingContext2D,
  edge: RenderBorderEdge,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  ctx.fillStyle = edge.color;
  const size = Math.round(edge.width);
  const horizontal = y1 === y2;
  const start = Math.round(horizontal ? x1 : y1);
  const end = Math.round(horizontal ? x2 : y2);
  const row = Math.round((horizontal ? y1 : x1) - edge.width / 2);
  const span = end - start;
  const dot = (offset: number) => {
    if (horizontal) {
      ctx.fillRect(start + offset, row, size, size);
    } else {
      ctx.fillRect(row, start + offset, size, size);
    }
  };
  dot(0);
  if (size === 1) {
    // Hairline (2026-07-28 probe): dots every 2px anchored at BOTH
    // ends, an even span resolving the parity clash with a double dot
    // at the start — offsets {0,1,3,5,…,L−1}; odd {0,2,…,L−1}.
    let from = 2;
    if (span > 1 && span % 2 === 0) {
      dot(1);
      from = 3;
    }
    for (let offset = from; offset < span; offset += 2) {
      dot(offset);
    }
    return;
  }
  // 2px (b52 writing-pad probe, 2026-08-10): a dot flush at EACH end,
  // and a regular period-4 interior series at 3+4k leaving a 1px gap
  // against both end dots (measured offsets 0,3,7,…,635,638 on a
  // 640px rule — 161 binary 2×2 dots).
  dot(span - size);
  for (let offset = size + 1; offset <= span - 2 * size - 1; offset += 2 * size) {
    dot(offset);
  }
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

function getDashPattern(style: RenderBorderEdge['style'], width: number): number[] {
  if (style === 'dotted') return [0.001, width * 1.5];
  if (style === 'dashed') return [width * 3, width * 2];
  return [];
}
