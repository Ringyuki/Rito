import type {
  CanvasBlockBorderBox,
  CanvasBlockBorderPaint,
  CanvasBlockBorderPaintEdge,
} from './types';

export interface RenderBorderEdge {
  readonly width: number;
  readonly color: string;
  readonly style: CanvasBlockBorderPaintEdge['style'];
}

export interface RenderBorders {
  readonly top: RenderBorderEdge;
  readonly right: RenderBorderEdge;
  readonly bottom: RenderBorderEdge;
  readonly left: RenderBorderEdge;
}

export interface RoundedBorderGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly cornerRadiusX: number;
  readonly cornerRadiusY: number;
  readonly innerX: number;
  readonly innerY: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly innerRadiusX: number;
  readonly innerRadiusY: number;
  readonly centerX: number;
  readonly centerY: number;
}

export type BorderSide = readonly [RenderBorderEdge, number, number, number, number];

const ZERO_EDGE: RenderBorderEdge = { width: 0, color: '#000', style: 'solid' };

export function toRenderBorders(
  borderBox: CanvasBlockBorderBox | undefined,
  paint: CanvasBlockBorderPaint | undefined,
): RenderBorders | undefined {
  if (!borderBox && !paint) return undefined;
  return {
    top: toRenderBorderEdge(borderBox?.topWidth, paint?.top),
    right: toRenderBorderEdge(borderBox?.rightWidth, paint?.right),
    bottom: toRenderBorderEdge(borderBox?.bottomWidth, paint?.bottom),
    left: toRenderBorderEdge(borderBox?.leftWidth, paint?.left),
  };
}

export function hasVisibleBorder({ top, right, bottom, left }: RenderBorders): boolean {
  return top.width > 0 || right.width > 0 || bottom.width > 0 || left.width > 0;
}

export function bordersAreUniform({ top, right, bottom, left }: RenderBorders): boolean {
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

export function resolveRoundedBorderGeometry(
  borders: RenderBorders,
  x: number,
  y: number,
  width: number,
  height: number,
  radiusX: number,
  radiusY: number,
): RoundedBorderGeometry {
  const { top, right, bottom, left } = borders;
  // CSS Backgrounds §5.5 overlap scaling: both axes shrink by ONE factor
  // when a short edge would make adjacent corners cross (per-axis clamps
  // turned wide badges into ellipses where Blink draws stadiums).
  const overlap = Math.min(
    1,
    radiusX > 0 ? width / (2 * radiusX) : 1,
    radiusY > 0 ? height / (2 * radiusY) : 1,
  );
  const cornerRadiusX = radiusX * overlap;
  const cornerRadiusY = radiusY * overlap;
  const maxBorder = Math.max(top.width, right.width, bottom.width, left.width);
  return {
    x,
    y,
    width,
    height,
    cornerRadiusX,
    cornerRadiusY,
    innerX: x + left.width,
    innerY: y + top.width,
    innerWidth: width - left.width - right.width,
    innerHeight: height - top.width - bottom.width,
    innerRadiusX: Math.max(0, cornerRadiusX - maxBorder),
    innerRadiusY: Math.max(0, cornerRadiusY - maxBorder),
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
}

export function getBorderSides(
  borders: RenderBorders,
  geometry: RoundedBorderGeometry,
): readonly BorderSide[] {
  const { top, right, bottom, left } = borders;
  const { x, y, width, height } = geometry;
  return [
    [top, x, y, x + width, y],
    [right, x + width, y, x + width, y + height],
    [bottom, x + width, y + height, x, y + height],
    [left, x, y + height, x, y],
  ];
}

function toRenderBorderEdge(
  width: number | undefined,
  paint: CanvasBlockBorderPaintEdge | undefined,
): RenderBorderEdge {
  if (width === undefined || width <= 0 || !paint) return ZERO_EDGE;
  return { width, color: paint.color, style: paint.style };
}
