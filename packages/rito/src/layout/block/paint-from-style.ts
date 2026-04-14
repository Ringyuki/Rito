// Centralised assembly of LayoutBlock paint metadata from a ComputedStyle.
// Every call site that previously copied render-only fields onto LayoutBlock
// one-by-one (flow-layout, float-layout, primitives, etc.) should instead
// call `blockPaintFromStyle` (and `borderBoxFromStyle`) and attach the
// resulting optional objects.

import type {
  BlockBackgroundPaint,
  BlockBorderPaint,
  BlockPaint,
  BlockRadius,
  BorderBox,
} from '../core/paint';
import type { ComputedStyle } from '../../style/core/types';
import type { BorderPaintEdge } from '../../style/core/paint-types';

/** Extract the border widths as a BorderBox. Returns undefined when no edge
 *  has a non-zero drawable width. */
export function borderBoxFromStyle(style: ComputedStyle): BorderBox | undefined {
  const t = edgeWidth(style.borderTop);
  const r = edgeWidth(style.borderRight);
  const b = edgeWidth(style.borderBottom);
  const l = edgeWidth(style.borderLeft);
  if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
  return { topWidth: t, rightWidth: r, bottomWidth: b, leftWidth: l };
}

/** Assemble the paint metadata for a LayoutBlock. Returns undefined when
 *  the style contributes nothing beyond pure geometry. */
export function blockPaintFromStyle(style: ComputedStyle): BlockPaint | undefined {
  const background = extractBackground(style);
  const border = extractBorderPaint(style);
  const radius = extractRadius(style);
  const hasOpacity = style.opacity < 1;
  const hasShadow = style.boxShadow.length > 0;
  const hasTransform = style.transform.length > 0;
  const clip = style.overflow === 'hidden';

  if (!background && !border && !radius && !hasOpacity && !hasShadow && !hasTransform && !clip) {
    return undefined;
  }

  const paint: Mutable<BlockPaint> = {};
  if (background) paint.background = background;
  if (border) paint.border = border;
  if (radius) paint.radius = radius;
  if (hasOpacity) paint.opacity = style.opacity;
  if (hasShadow) paint.boxShadow = style.boxShadow;
  if (hasTransform) paint.transform = style.transform;
  if (clip) paint.clipToBounds = true;
  return paint;
}

function extractBackground(style: ComputedStyle): BlockBackgroundPaint | undefined {
  const color = style.backgroundColor;
  const image = style.backgroundImage;
  if (!color && !image) return undefined;
  const bg: Mutable<BlockBackgroundPaint> = {};
  if (color) bg.color = color;
  if (image) bg.image = image;
  if (style.backgroundSize) bg.size = style.backgroundSize;
  if (style.backgroundRepeat) bg.repeat = style.backgroundRepeat;
  if (style.backgroundPosition) bg.position = style.backgroundPosition;
  return bg;
}

function extractBorderPaint(style: ComputedStyle): BlockBorderPaint | undefined {
  const top = edgePaint(style.borderTop);
  const right = edgePaint(style.borderRight);
  const bottom = edgePaint(style.borderBottom);
  const left = edgePaint(style.borderLeft);
  if (!top && !right && !bottom && !left) return undefined;
  const out: Mutable<BlockBorderPaint> = {};
  if (top) out.top = top;
  if (right) out.right = right;
  if (bottom) out.bottom = bottom;
  if (left) out.left = left;
  return out;
}

function extractRadius(style: ComputedStyle): BlockRadius | undefined {
  if (style.borderRadiusPct !== undefined) return { pct: style.borderRadiusPct };
  if (style.borderRadius > 0) return { px: style.borderRadius };
  return undefined;
}

interface BorderSide {
  readonly width: number;
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed' | 'none';
}

function edgeWidth(side: BorderSide): number {
  return side.style === 'none' ? 0 : side.width;
}

function edgePaint(side: BorderSide): BorderPaintEdge | undefined {
  if (side.style === 'none' || side.width <= 0) return undefined;
  return { color: side.color, style: side.style };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
