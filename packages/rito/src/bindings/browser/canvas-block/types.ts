import type { CoreFrameCommand } from '../core-contracts';

export type CanvasBlockCommand = Extract<CoreFrameCommand, { readonly kind: 'paintBlock' }>;
export type CanvasBlockRect = CanvasBlockCommand['rect'];
export type CanvasBlockPaint = CanvasBlockCommand['paint'];
export type CanvasBlockBackgroundPaint = NonNullable<CanvasBlockPaint['background']>;
export type CanvasBlockBorderPaint = NonNullable<CanvasBlockPaint['border']>;
export type CanvasBlockBorderBox = NonNullable<CanvasBlockCommand['borderBox']>;
export type CanvasBlockBoxShadow = NonNullable<CanvasBlockPaint['boxShadow']>[number];
export type CanvasBlockBorderPaintEdge = NonNullable<CanvasBlockBorderPaint['top']>;

export interface CanvasBlockResolvedRadius {
  readonly rx: CanvasBlockRect['width'];
  readonly ry: CanvasBlockRect['height'];
  /** Per-corner circular radii (CSS order) when the corners disagree. */
  readonly corners?: readonly [number, number, number, number];
}

export type CanvasBlockImageResolver = (
  src: NonNullable<CanvasBlockBackgroundPaint['image']>,
) => ImageBitmap | undefined;
