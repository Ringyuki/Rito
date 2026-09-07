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

/** The paint a text run carries: what the renderer needs to raster its
 * glyphs. The run's inline box (background band, padding, borders) and its
 * decoration line lower to primitives around the run in the engine. */
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
  readonly textShadows: readonly {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly blur: number;
    readonly color: RitoReaderColorV1;
  }[];
}

/** The text run body the text and ruby primitives carry; every length
 * is in CSS pixels, drawn under the list's ratio. */
export interface RitoReaderTextRunV1 {
  readonly text: string;
  readonly rect: RitoReaderRectV1;
  readonly paint: RitoReaderRunPaintV1;
  readonly lineHeightPx?: number | undefined;
  readonly href?: string | undefined;
  readonly sourceText?: string | undefined;
  readonly sourceTextOffset?: bigint | undefined;
  /** Vertical writing: one downward column, `rect.x` its left edge and
   * `rect.y` the first glyph's top. */
  readonly vertical: boolean;
  /** The origin of every cluster in text order; empty when the renderer
   * still places the run itself (a vertical column, an annotation). */
  readonly clusters: readonly RitoReaderClusterV1[];
}

/** Where one cluster of a run paints: the origin of the cluster starting
 * at `byte` of the run's UTF-8 text, in CSS pixels, spacing and
 * justification already applied. */
export interface RitoReaderClusterV1 {
  readonly byte: number;
  readonly x: number;
}
