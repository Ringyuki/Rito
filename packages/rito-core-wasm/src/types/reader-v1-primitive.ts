import type { RitoReaderColorV1, RitoReaderRectV1, RitoReaderTextRunV1 } from './reader-v1-display';

/**
 * `RITODL1` format version 2: the device-resolved primitive list. Every
 * coordinate is a device pixel on the grid the host rasterizes, and every
 * rule about where ink lands has been applied by the engine. Text runs
 * stay in CSS pixels and are drawn under `scale(ratio)`: glyph
 * rasterization follows the CSS font size (synthetic bold widens with
 * it), so the device size on the device grid rasters different ink. Their
 * glyph placement is still the renderer's.
 */
export interface RitoReaderPrimitiveListV1 {
  readonly formatVersion: 2;
  /** Device pixels per CSS pixel the list was resolved at. */
  readonly ratio: number;
  readonly commandCount: number;
  readonly commands: readonly RitoReaderPrimitiveV1[];
}

export interface RitoReaderDevicePointV1 {
  readonly x: number;
  readonly y: number;
}

/** Arc angles are radians from the +x axis; a positive sweep turns
 * clockwise on the y-down device plane. An ellipse is its own closed
 * subpath. */
export type RitoReaderPathOpV1 =
  | { readonly op: 'move-to'; readonly x: number; readonly y: number }
  | { readonly op: 'line-to'; readonly x: number; readonly y: number }
  | {
      readonly op: 'arc';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly start: number;
      readonly sweep: number;
    }
  | {
      readonly op: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
    }
  | {
      readonly op: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly op: 'close' };

export type RitoReaderDeviceTransformV1 =
  | { readonly kind: 'rotate'; readonly radians: number }
  | { readonly kind: 'scale'; readonly sx: number; readonly sy: number }
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number };

/** What a fill declares to the theme override: the page ground, an
 * opaque block ground the ink over it was typeset against (with
 * `groundRect`, the unsnapped box it covers), or nothing. */
export type RitoReaderFillGroundV1 = 'none' | 'page' | 'block';

export interface RitoReaderTilePlanV1 {
  readonly origin: RitoReaderDevicePointV1;
  readonly stepX: number;
  readonly stepY: number;
  readonly columns: number;
  readonly rows: number;
}

export interface RitoReaderTextPrimitiveV1 extends RitoReaderTextRunV1 {
  readonly kind: 'text' | 'ruby';
}

export type RitoReaderPrimitiveV1 =
  | { readonly kind: 'push-state' }
  | { readonly kind: 'pop-state' }
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'opacity'; readonly value: number }
  | {
      readonly kind: 'transform';
      readonly origin: RitoReaderDevicePointV1;
      readonly transforms: readonly RitoReaderDeviceTransformV1[];
    }
  | { readonly kind: 'clip-path'; readonly path: readonly RitoReaderPathOpV1[] }
  | {
      readonly kind: 'fill-rect';
      readonly rect: RitoReaderRectV1;
      readonly color: RitoReaderColorV1;
      readonly ground: RitoReaderFillGroundV1;
      readonly groundRect?: RitoReaderRectV1 | undefined;
    }
  | {
      readonly kind: 'fill-path';
      readonly path: readonly RitoReaderPathOpV1[];
      readonly rule: 'nonzero' | 'evenodd';
      readonly color: RitoReaderColorV1;
      readonly ground: RitoReaderFillGroundV1;
      readonly groundRect?: RitoReaderRectV1 | undefined;
    }
  | {
      readonly kind: 'stroke-path';
      readonly path: readonly RitoReaderPathOpV1[];
      readonly width: number;
      readonly color: RitoReaderColorV1;
      readonly cap: 'butt' | 'round';
      readonly dash?: { readonly on: number; readonly off: number } | undefined;
    }
  | {
      readonly kind: 'shadow';
      readonly shape: readonly RitoReaderPathOpV1[];
      /** Gaussian sigma in device pixels. */
      readonly sigma: number;
      readonly offset: RitoReaderDevicePointV1;
      readonly color: RitoReaderColorV1;
      readonly clipOut?: readonly RitoReaderPathOpV1[] | undefined;
    }
  | {
      readonly kind: 'draw-image';
      readonly src: string;
      readonly dest: RitoReaderRectV1;
      /** Raster-pixel subregion to sample; absent samples the whole raster. */
      readonly sourceRect?: RitoReaderRectV1 | undefined;
      readonly tiles?: RitoReaderTilePlanV1 | undefined;
    }
  | RitoReaderTextPrimitiveV1;
