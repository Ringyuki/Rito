/**
 * The paint vocabulary the `RITODL1` primitive list shares with the
 * engine's typed contract: rects, typed colours, border edge paints and
 * the text run body carried by the text and ruby primitives.
 */
export interface RitoReaderRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RitoReaderColor {
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
export interface RitoReaderRunPaint {
  readonly font: {
    readonly family: string;
    readonly sizePx: number;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
  };
  readonly color: RitoReaderColor;
  readonly textShadows: readonly {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly blur: number;
    readonly color: RitoReaderColor;
  }[];
}

/** The text run body the text and ruby primitives carry; every length
 * is in CSS pixels, drawn under the list's ratio. */
export interface RitoReaderTextRun {
  readonly text: string;
  readonly rect: RitoReaderRect;
  readonly paint: RitoReaderRunPaint;
  readonly lineHeightPx?: number | undefined;
  readonly href?: string | undefined;
  readonly sourceText?: string | undefined;
  readonly sourceTextOffset?: bigint | undefined;
  /** The origin of every cluster in text order; empty only for a run the
   * renderer still places itself. */
  readonly clusters: readonly RitoReaderCluster[];
}

/** Where one cluster of a run paints: the origin of the cluster starting
 * at `byte` of the run's UTF-8 text, in CSS pixels — `y` is the
 * alphabetic baseline of a text run, the em-box top of an annotation;
 * spacing, justification and ruby distribution are already applied. */
export interface RitoReaderCluster {
  readonly byte: number;
  readonly x: number;
  readonly y: number;
}
