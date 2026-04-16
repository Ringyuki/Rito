// Paint-ready data shapes produced by layout for render consumption.
// These types are the "Phase 2" consolidation of render-only fields that
// previously lived at the top of layout nodes (LayoutBlock / TextRun / Hr /
// Page). Layout fills them; render only reads them.

import type {
  BackgroundPosition,
  BorderPaintEdge,
  FontShorthand,
  TransformFn,
} from '../../style/core/paint-types';
import type { BoxShadow, TextShadow } from '../../style/core/types';

// ────────────────────────────────────────
// Block-level paint
// ────────────────────────────────────────

/** Physical border widths for a layout block (geometry — already baked into
 *  block.bounds via the box model). Colour / style live in BlockBorderPaint. */
export interface BorderBox {
  readonly topWidth: number;
  readonly rightWidth: number;
  readonly bottomWidth: number;
  readonly leftWidth: number;
}

/** Background paint layers for a block. `color` and `image` may coexist
 *  (image renders over color per CSS semantics). */
export interface BlockBackgroundPaint {
  readonly color?: string;
  readonly image?: string;
  readonly size?: 'cover' | 'contain' | 'auto';
  readonly repeat?: 'repeat' | 'no-repeat';
  readonly position?: BackgroundPosition;
}

/** Per-edge border paint (colour + style). Absent edges are not drawn. */
export interface BlockBorderPaint {
  readonly top?: BorderPaintEdge;
  readonly right?: BorderPaintEdge;
  readonly bottom?: BorderPaintEdge;
  readonly left?: BorderPaintEdge;
}

/** Rounded-corner radius, optionally as a percentage of block dimensions. */
export interface BlockRadius {
  readonly px?: number;
  readonly pct?: number;
}

/** Aggregate of all render-only block paint metadata. Any field may be
 *  absent; render skips that aspect when a field is missing. */
export interface BlockPaint {
  readonly background?: BlockBackgroundPaint;
  readonly border?: BlockBorderPaint;
  readonly radius?: BlockRadius;
  readonly opacity?: number;
  readonly boxShadow?: readonly BoxShadow[];
  readonly transform?: readonly TransformFn[];
  /** Clip children to block bounds (derived from `overflow: hidden`). */
  readonly clipToBounds?: boolean;
  /** Translation applied before drawing, derived from `position: relative`.
   *  Does not affect layout flow. */
  readonly visualOffset?: { readonly dx: number; readonly dy: number };
}

// ────────────────────────────────────────
// Text-run paint
// ────────────────────────────────────────

/** Paint-ready decoration line. Geometry (y / thickness) is pre-computed at
 *  layout time from font metrics so render never re-derives it. */
export type RunDecoration =
  | {
      readonly kind: 'underline';
      readonly y: number;
      readonly thickness: number;
      readonly color: string;
    }
  | {
      readonly kind: 'line-through';
      readonly y: number;
      readonly thickness: number;
      readonly color: string;
    };

/** Horizontal border edge on a run: width is geometry (baked into run.bounds
 *  via inline insets), color + style are render. */
export interface RunBorderEdge {
  readonly widthPx: number;
  readonly paint: BorderPaintEdge;
}

/** Border paint for a run. Top / bottom apply to every fragment of a run;
 *  start / end are only present on the first / last fragment of a multi-line
 *  inline span. Absence = not drawn. Each edge carries both its width (baked
 *  into run.bounds via inline inset accounting) and its visual paint. */
export interface RunBorder {
  readonly top?: RunBorderEdge;
  readonly bottom?: RunBorderEdge;
  readonly start?: RunBorderEdge;
  readonly end?: RunBorderEdge;
}

// Spacing (inline-box padding insets, 4 sides) is imported below from the
// shared `model` types so a single canonical shape is re-exported from
// `@ritojs/core/advanced`.
import type { Spacing } from '../../model/types';
export type { Spacing } from '../../model/types';

/** Paint metadata for a single TextRun. Strictly the render-consumed subset —
 *  no ComputedStyle leakage. Composed by the layout pipeline via
 *  `runPaintFromStyle`. */
export interface RunPaint {
  readonly color: string;
  readonly font: FontShorthand;
  readonly wordSpacingPx?: number;
  readonly letterSpacingPx?: number;
  readonly backgroundColor?: string;
  /** Corner radius applied to the inline background fill. */
  readonly backgroundRadius?: number;
  readonly textShadow?: readonly TextShadow[];
  readonly decoration?: RunDecoration;
  readonly padding?: Spacing;
  readonly border?: RunBorder;
}

// ────────────────────────────────────────
// Horizontal rule & Page paint
// ────────────────────────────────────────

/** Paint for a single <hr> element. */
export interface HrPaint {
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed';
}

/** Page-level paint (per-chapter body background etc). */
export interface PagePaint {
  readonly backgroundColor?: string;
}
