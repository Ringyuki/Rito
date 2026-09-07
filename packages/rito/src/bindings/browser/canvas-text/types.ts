import type { CoreFrameCommand } from '../core-contracts';

export type CanvasTextCommand = Extract<CoreFrameCommand, { readonly kind: 'paintText' }>;
export type CanvasRubyCommand = Extract<CoreFrameCommand, { readonly kind: 'paintRuby' }>;
export type CanvasTextFragment = Pick<CanvasTextCommand, 'text' | 'rect' | 'paint' | 'clusters'>;
export type CanvasRubyFragment = Pick<CanvasRubyCommand, 'text' | 'rect' | 'paint' | 'clusters'>;
export type CanvasRunPaint = CanvasTextCommand['paint'];
export type CanvasFontShorthand = CanvasRunPaint['font'];
export type CanvasTextShadow = NonNullable<CanvasRunPaint['textShadow']>[number];

export interface CanvasTextColorOverride {
  readonly foregroundColor: string;
  readonly backgroundColor: string;
}
