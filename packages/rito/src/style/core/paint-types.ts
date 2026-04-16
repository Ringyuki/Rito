/**
 * Shared paint-ready structured types.
 *
 * These types carry CSS values that, after style cascade resolution, are
 * already in a shape that layout, render, and interaction helpers can
 * consume without further string parsing or derivation.
 *
 * The higher-level paint aggregates live in `layout/core/paint.ts`; this
 * module holds the reusable leaf primitives that are shared across those
 * aggregates and text measurement helpers.
 */

/** Length with explicit unit. Percentages are resolved against a host box at
 * paint time (e.g. transform: translate(%, %) against the block's bounds). */
export type LengthPct =
  | { readonly unit: 'px'; readonly value: number }
  | { readonly unit: 'percent'; readonly value: number };

/** A single CSS transform function. matrix / skew / 3D are intentionally
 * unsupported — style parser emits a single warn and drops unsupported
 * functions. */
export type TransformFn =
  | { readonly kind: 'translate'; readonly x: LengthPct; readonly y: LengthPct }
  | { readonly kind: 'scale'; readonly sx: number; readonly sy: number }
  | { readonly kind: 'rotate'; readonly rad: number };

/** CSS background-position resolved to per-axis length / percentage. */
export interface BackgroundPosition {
  readonly x: LengthPct;
  readonly y: LengthPct;
}

/** A resolved font shorthand, ready to be serialized to a CSS font string or
 * consumed by a text measurer. */
export interface FontShorthand {
  readonly style: 'normal' | 'italic';
  readonly weight: number;
  readonly sizePx: number;
  readonly family: string;
}

/** Minimal paint subset required by TextMeasurer. Shared by layout, render,
 * and interaction code that only needs text-advance inputs. */
export interface MeasurePaint {
  readonly font: FontShorthand;
  readonly wordSpacingPx?: number;
}

/** Border paint side: colour and style only. Width is geometry (BorderBox)
 * and stays on the layout side; this type is the render-only counterpart
 * that Phase 2 will consume via BlockPaint.border. */
export interface BorderPaintEdge {
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed';
}
