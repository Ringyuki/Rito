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

export interface RitoReaderLengthV1 {
  readonly unit: 'px' | 'percent';
  readonly value: number;
}

/**
 * Circular corner radii in CSS order (top-left, top-right, bottom-right,
 * bottom-left) for boxes whose corners disagree.
 */
export interface RitoReaderCornerRadiiV1 {
  readonly unit: 'corners';
  readonly corners: readonly [number, number, number, number];
}

export interface RitoReaderBackgroundPaintV1 {
  readonly color?: RitoReaderColorV1 | undefined;
  readonly image?: string | undefined;
  readonly size?: 'auto' | 'cover' | 'contain' | undefined;
  readonly repeat?:
    | 'repeat'
    | 'no-repeat'
    | 'repeat-x'
    | 'repeat-y'
    | 'space'
    | 'round'
    | undefined;
  readonly position?:
    | { readonly x: RitoReaderLengthV1; readonly y: RitoReaderLengthV1 }
    | undefined;
}

export interface RitoReaderBlockPaintV1 {
  readonly background?: RitoReaderBackgroundPaintV1 | undefined;
  readonly border?:
    | {
        readonly top?: RitoReaderBorderEdgePaintV1 | undefined;
        readonly right?: RitoReaderBorderEdgePaintV1 | undefined;
        readonly bottom?: RitoReaderBorderEdgePaintV1 | undefined;
        readonly left?: RitoReaderBorderEdgePaintV1 | undefined;
      }
    | undefined;
  readonly radius?: RitoReaderLengthV1 | RitoReaderCornerRadiiV1 | undefined;
  readonly boxShadows: readonly {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly blur: number;
    readonly spread: number;
    readonly color: RitoReaderColorV1;
    readonly inset: boolean;
  }[];
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

export type RitoReaderDisplayCommandV1 =
  | { readonly kind: 'push-state'; readonly opcode: 1 }
  | { readonly kind: 'pop-state'; readonly opcode: 2 }
  | { readonly kind: 'translate'; readonly opcode: 3; readonly dx: number; readonly dy: number }
  | { readonly kind: 'opacity'; readonly opcode: 4; readonly value: number }
  | RitoReaderTransformCommandV1
  | {
      readonly kind: 'clip-rect';
      readonly opcode: 6;
      readonly rect: RitoReaderRectV1;
      readonly radius?: { readonly rx: number; readonly ry: number } | undefined;
    }
  | {
      readonly kind: 'paint-page';
      readonly opcode: 7;
      readonly rect: RitoReaderRectV1;
      readonly paint: { readonly backgroundColor?: RitoReaderColorV1 | undefined };
    }
  | RitoReaderPaintBlockCommandV1
  | RitoReaderPaintTextCommandV1
  | RitoReaderPaintImageCommandV1
  | {
      readonly kind: 'paint-horizontal-rule';
      readonly opcode: 12;
      readonly rect: RitoReaderRectV1;
      readonly paint: {
        readonly color: RitoReaderColorV1;
        readonly style: RitoReaderBorderStyleV1;
      };
    };

export interface RitoReaderTransformCommandV1 {
  readonly kind: 'transform';
  readonly opcode: 5;
  readonly origin: { readonly x: number; readonly y: number };
  readonly boxSize: { readonly width: number; readonly height: number };
  readonly transforms: readonly (
    | { readonly kind: 'rotate'; readonly radians: number }
    | { readonly kind: 'scale'; readonly sx: number; readonly sy: number }
    | { readonly kind: 'translate'; readonly x: RitoReaderLengthV1; readonly y: RitoReaderLengthV1 }
  )[];
}

export interface RitoReaderPaintBlockCommandV1 {
  readonly kind: 'paint-block';
  readonly opcode: 8;
  readonly rect: RitoReaderRectV1;
  readonly paint: RitoReaderBlockPaintV1;
  readonly borderBox?:
    | {
        readonly topWidth: number;
        readonly rightWidth: number;
        readonly bottomWidth: number;
        readonly leftWidth: number;
      }
    | undefined;
}

export interface RitoReaderPaintTextCommandV1 {
  readonly kind: 'paint-text' | 'paint-ruby';
  readonly opcode: 9 | 10;
  readonly text: string;
  readonly rect: RitoReaderRectV1;
  readonly paint: RitoReaderRunPaintV1;
  readonly lineHeightPx?: number | undefined;
  readonly href?: string | undefined;
  readonly sourceText?: string | undefined;
  readonly sourceTextOffset?: bigint | undefined;
}

export interface RitoReaderPaintImageCommandV1 {
  readonly kind: 'paint-image';
  readonly opcode: 11;
  readonly src: string;
  readonly rect: RitoReaderRectV1;
  readonly alt?: string | undefined;
  readonly href?: string | undefined;
  /** Raster-pixel subregion to sample; absent samples the whole raster. */
  readonly sourceRect?: RitoReaderRectV1 | undefined;
}

export interface RitoReaderDisplayListV1 {
  readonly formatVersion: 1;
  readonly commandCount: number;
  readonly commands: readonly RitoReaderDisplayCommandV1[];
}
