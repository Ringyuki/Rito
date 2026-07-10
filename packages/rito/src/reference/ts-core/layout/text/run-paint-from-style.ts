// Assemble the minimal paint-ready subset required by text rendering from a
// resolved ComputedStyle. Centralising the derivation here ensures render
// never needs to see ComputedStyle and that all inline-box geometry decisions
// (padding rect, border edges, decoration line baselines, etc.) happen at
// layout time.

import type { ComputedStyle } from '../../style/core/types';
import type { RunBorder, RunBorderEdge, RunDecoration, RunPaint, Spacing } from '../core/paint';
import { fontShorthandFromStyle } from '../../style/css/font-shorthand';

/** Minimal valid RunPaint. Useful for test fixtures that build TextRuns by
 *  hand; production code should go through `runPaintFromStyle`. */
export const DEFAULT_RUN_PAINT: RunPaint = {
  color: '#000000',
  font: { style: 'normal', weight: 400, sizePx: 16, family: 'serif' },
};

interface Fragment {
  /** First fragment of a bordered inline box — draw left border. */
  readonly start: boolean;
  /** Last fragment of a bordered inline box — draw right border. */
  readonly end: boolean;
}

/** Build a {@link RunPaint} from a ComputedStyle. `fragment` tells the
 *  factory whether this run is the first / last fragment of its inline span
 *  (controls which side borders get start / end edge paint). */
export function runPaintFromStyle(style: ComputedStyle, fragment: Fragment): RunPaint {
  const paint: Mutable<RunPaint> = {
    color: style.color,
    font: fontShorthandFromStyle(style),
  };
  if (style.wordSpacing !== 0) paint.wordSpacingPx = style.wordSpacing;
  if (style.letterSpacing !== 0) paint.letterSpacingPx = style.letterSpacing;
  if (style.backgroundColor) paint.backgroundColor = style.backgroundColor;
  if (style.borderRadius > 0) paint.backgroundRadius = style.borderRadius;
  if (style.textShadow.length > 0) paint.textShadow = style.textShadow;

  const decoration = decorationFromStyle(style);
  if (decoration) paint.decoration = decoration;

  const padding = paddingFromStyle(style);
  if (padding) paint.padding = padding;

  const border = borderFromStyle(style, fragment);
  if (border) paint.border = border;

  return paint;
}

function decorationFromStyle(style: ComputedStyle): RunDecoration | undefined {
  // Geometry pre-computation. Offsets are relative to run.bounds.y top edge.
  //   underline   y = fontSize      (below baseline approximation)
  //   line-through y = fontSize / 2 (mid-cap)
  // Thickness 1px matches the legacy renderer's hardcoded stroke width.
  if (style.textDecoration === 'underline') {
    return { kind: 'underline', y: style.fontSize, thickness: 1, color: style.color };
  }
  if (style.textDecoration === 'line-through') {
    return { kind: 'line-through', y: style.fontSize * 0.5, thickness: 1, color: style.color };
  }
  return undefined;
}

function paddingFromStyle(style: ComputedStyle): Spacing | undefined {
  const t = style.paddingTop;
  const r = style.paddingRight;
  const b = style.paddingBottom;
  const l = style.paddingLeft;
  if (t === 0 && r === 0 && b === 0 && l === 0) return undefined;
  return { top: t, right: r, bottom: b, left: l };
}

function borderFromStyle(style: ComputedStyle, fragment: Fragment): RunBorder | undefined {
  const top = drawableEdge(style.borderTop);
  const bottom = drawableEdge(style.borderBottom);
  const start = fragment.start ? drawableEdge(style.borderLeft) : undefined;
  const end = fragment.end ? drawableEdge(style.borderRight) : undefined;

  if (!top && !bottom && !start && !end) return undefined;

  const border: Mutable<RunBorder> = {};
  if (top) border.top = top;
  if (bottom) border.bottom = bottom;
  if (start) border.start = start;
  if (end) border.end = end;
  return border;
}

interface BorderSide {
  readonly width: number;
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed' | 'none';
}

function drawableEdge(side: BorderSide): RunBorderEdge | undefined {
  if (side.style === 'none' || side.width <= 0) return undefined;
  return {
    widthPx: side.width,
    paint: { color: side.color, style: side.style },
  };
}

/**
 * Return a copy of `paint` with the trailing `end` border edge filled from
 * `style.borderRight`. Used by the KP line-breaker's trailing-edge tracker
 * to stamp the `borderEnd` equivalent onto the last run of a segment after
 * the run has already been pushed with an end-less paint.
 */
export function withTrailingEndEdge(paint: RunPaint, style: ComputedStyle): RunPaint {
  const edge = drawableEdge(style.borderRight);
  if (!edge) return paint;
  const border: Mutable<RunBorder> = { ...(paint.border ?? {}) };
  border.end = edge;
  return { ...paint, border };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
