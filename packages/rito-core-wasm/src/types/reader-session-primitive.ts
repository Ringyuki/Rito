import type { RitoReaderColor, RitoReaderRect, RitoReaderTextRun } from './reader-session-display';

/**
 * `RITODL1` format version 2: the device-resolved primitive list. Every
 * coordinate is a device pixel on the grid the host rasterizes, and every
 * rule about where ink lands has been applied by the engine. Text runs
 * stay in CSS pixels and are drawn under `scale(ratio)`: glyph
 * rasterization follows the CSS font size (synthetic bold widens with
 * it), so the device size on the device grid rasters different ink. Their
 * glyph placement is still the renderer's.
 */
export interface RitoReaderPrimitiveList {
  readonly formatVersion: 2;
  /** Device pixels per CSS pixel the list was resolved at. */
  readonly ratio: number;
  readonly commandCount: number;
  readonly commands: readonly RitoReaderPrimitive[];
}

export interface RitoReaderDevicePoint {
  readonly x: number;
  readonly y: number;
}

/** Arc angles are radians from the +x axis; a positive sweep turns
 * clockwise on the y-down device plane. An ellipse is its own closed
 * subpath. */
export type RitoReaderPathOp =
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

export type RitoReaderDeviceTransform =
  | { readonly kind: 'rotate'; readonly radians: number }
  | { readonly kind: 'scale'; readonly sx: number; readonly sy: number }
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number };

/** What a fill declares to the theme override: the page ground, an
 * opaque block ground the ink over it was typeset against (with
 * `groundRect`, the unsnapped box it covers), or nothing. */
export type RitoReaderFillGround = 'none' | 'page' | 'block';

export interface RitoReaderTilePlan {
  readonly origin: RitoReaderDevicePoint;
  readonly stepX: number;
  readonly stepY: number;
  readonly columns: number;
  readonly rows: number;
}

export interface RitoReaderTextPrimitive extends RitoReaderTextRun {
  readonly kind: 'text' | 'ruby';
}

export type RitoReaderPrimitive =
  | { readonly kind: 'push-state' }
  | { readonly kind: 'pop-state' }
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'opacity'; readonly value: number }
  | {
      readonly kind: 'transform';
      readonly origin: RitoReaderDevicePoint;
      readonly transforms: readonly RitoReaderDeviceTransform[];
    }
  | { readonly kind: 'clip-path'; readonly path: readonly RitoReaderPathOp[] }
  | {
      readonly kind: 'fill-rect';
      readonly rect: RitoReaderRect;
      readonly color: RitoReaderColor;
      readonly ground: RitoReaderFillGround;
      readonly groundRect?: RitoReaderRect | undefined;
    }
  | {
      readonly kind: 'fill-path';
      readonly path: readonly RitoReaderPathOp[];
      readonly rule: 'nonzero' | 'evenodd';
      readonly color: RitoReaderColor;
      readonly ground: RitoReaderFillGround;
      readonly groundRect?: RitoReaderRect | undefined;
    }
  | {
      readonly kind: 'stroke-path';
      readonly path: readonly RitoReaderPathOp[];
      readonly width: number;
      readonly color: RitoReaderColor;
      readonly cap: 'butt' | 'round';
      readonly dash?: { readonly on: number; readonly off: number } | undefined;
    }
  | {
      readonly kind: 'shadow';
      readonly shape: readonly RitoReaderPathOp[];
      /** Gaussian sigma in device pixels. */
      readonly sigma: number;
      readonly offset: RitoReaderDevicePoint;
      readonly color: RitoReaderColor;
      readonly clipOut?: readonly RitoReaderPathOp[] | undefined;
    }
  | {
      readonly kind: 'draw-image';
      readonly src: string;
      readonly dest: RitoReaderRect;
      /** Raster-pixel subregion to sample; absent samples the whole raster. */
      readonly sourceRect?: RitoReaderRect | undefined;
      readonly tiles?: RitoReaderTilePlan | undefined;
    }
  | RitoReaderTextPrimitive;
