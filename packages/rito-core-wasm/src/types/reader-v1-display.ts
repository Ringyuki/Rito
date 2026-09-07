/**
 * The paint vocabulary the `RITODL1` primitive list shares with the
 * engine's typed contract: rects, typed colours, border edge paints and
 * the text run body carried by the text and ruby primitives.
 */
export interface RitoReaderRectV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RitoReaderColorV1 {
  readonly space:
    | 'srgb'
    | 'hsl'
    | 'hwb'
    | 'lab'
    | 'lch'
    | 'oklab'
    | 'oklch'
    | 'srgb-linear'
    | 'display-p3'
    | 'display-p3-linear'
    | 'a98-rgb'
    | 'prophoto-rgb'
    | 'rec2020'
    | 'xyz-d50'
    | 'xyz-d65';
  readonly component0: number;
  readonly component1: number;
  readonly component2: number;
  readonly alpha: number;
  readonly none: {
    readonly component0: boolean;
    readonly component1: boolean;
    readonly component2: boolean;
    readonly alpha: boolean;
  };
}

export type RitoReaderBorderStyleV1 =
  | 'none'
  | 'hidden'
  | 'dotted'
  | 'dashed'
  | 'solid'
  | 'double'
  | 'groove'
  | 'ridge'
  | 'inset'
  | 'outset';

export interface RitoReaderBorderEdgePaintV1 {
  readonly color: RitoReaderColorV1;
  readonly style: RitoReaderBorderStyleV1;
}

export interface RitoReaderRunPaintV1 {
  readonly font: {
    readonly family: string;
    readonly sizePx: number;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
  };
  readonly color: RitoReaderColorV1;
  readonly wordSpacingPx?: number | undefined;
  readonly letterSpacingPx?: number | undefined;
  readonly backgroundColor?: RitoReaderColorV1 | undefined;
  readonly backgroundRadius?: number | undefined;
  readonly textShadows: readonly {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly blur: number;
    readonly color: RitoReaderColorV1;
  }[];
  readonly decoration?:
    | {
        readonly kind: 'underline' | 'line-through';
        readonly y: number;
        readonly thickness: number;
        readonly color: RitoReaderColorV1;
      }
    | undefined;
  readonly padding?:
    | {
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
        readonly left: number;
      }
    | undefined;
  readonly border?: RitoReaderRunBorderV1 | undefined;
  /** Engine-computed inline box top/bottom relative to the run rect top;
   * absent when the run carries no box paint. */
  readonly boxOffsets?: { readonly top: number; readonly bottom: number } | undefined;
  /** Whether this run opens/closes its inline box; a run split across
   * lines squares the split ends. */
  readonly boxStart: boolean;
  readonly boxEnd: boolean;
}

export interface RitoReaderRunBorderV1 {
  readonly top?: RitoReaderRunBorderEdgeV1 | undefined;
  readonly bottom?: RitoReaderRunBorderEdgeV1 | undefined;
  readonly start?: RitoReaderRunBorderEdgeV1 | undefined;
  readonly end?: RitoReaderRunBorderEdgeV1 | undefined;
}

export interface RitoReaderRunBorderEdgeV1 {
  readonly widthPx: number;
  readonly paint: RitoReaderBorderEdgePaintV1;
}

/** The text run body the text and ruby primitives carry; every length
 * is already in device pixels. */
export interface RitoReaderTextRunV1 {
  readonly text: string;
  readonly rect: RitoReaderRectV1;
  readonly paint: RitoReaderRunPaintV1;
  readonly lineHeightPx?: number | undefined;
  readonly href?: string | undefined;
  readonly sourceText?: string | undefined;
  readonly sourceTextOffset?: bigint | undefined;
  /** Non-initial ruby-align keyword; absent means space-around. */
  readonly rubyAlign?: 'start' | 'center' | 'space-between' | undefined;
  /** Right-aligned draw: `rect.x` is the text's right edge and the host
   * measures the string to place the pen (outside list markers). */
  readonly alignRight: boolean;
  /** Vertical writing: one downward column, `rect.x` its left edge and
   * `rect.y` the first glyph's top. */
  readonly vertical: boolean;
}
