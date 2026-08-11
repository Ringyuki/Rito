export type RitoCoreWasmFrameCommand =
  | RitoCoreWasmPushStateCommand
  | RitoCoreWasmPopStateCommand
  | RitoCoreWasmTranslateCommand
  | RitoCoreWasmTransformCommand
  | RitoCoreWasmOpacityCommand
  | RitoCoreWasmClipRectCommand
  | RitoCoreWasmPaintPageCommand
  | RitoCoreWasmPaintBlockCommand
  | RitoCoreWasmPaintTextCommand
  | RitoCoreWasmPaintRubyCommand
  | RitoCoreWasmPaintImageCommand
  | RitoCoreWasmPaintHorizontalRuleCommand;

export interface RitoCoreWasmPushStateCommand {
  readonly kind: 'pushState';
}

export interface RitoCoreWasmPopStateCommand {
  readonly kind: 'popState';
}

export interface RitoCoreWasmTranslateCommand {
  readonly kind: 'translate';
  readonly dx: number;
  readonly dy: number;
}

export interface RitoCoreWasmTransformCommand {
  readonly kind: 'transform';
  readonly origin: RitoCoreWasmPoint;
  readonly box: RitoCoreWasmSize;
  readonly transforms: readonly RitoCoreWasmTransformFn[];
}

export interface RitoCoreWasmOpacityCommand {
  readonly kind: 'opacity';
  readonly value: number;
}

export interface RitoCoreWasmClipRectCommand {
  readonly kind: 'clipRect';
  readonly rect: RitoCoreWasmRect;
  readonly radius?: RitoCoreWasmResolvedRadius;
}

export interface RitoCoreWasmPaintPageCommand {
  readonly kind: 'paintPage';
  readonly rect: RitoCoreWasmRect;
  readonly paint: RitoCoreWasmPagePaint;
}

export interface RitoCoreWasmPaintBlockCommand {
  readonly kind: 'paintBlock';
  readonly rect: RitoCoreWasmRect;
  readonly paint: RitoCoreWasmBlockDecorationPaint;
  readonly borderBox?: RitoCoreWasmBorderBox;
}

export interface RitoCoreWasmPaintTextCommand extends RitoCoreWasmTextPaintCommand {
  readonly kind: 'paintText';
  readonly lineHeightPx?: number;
  readonly href?: string;
  readonly sourceText?: string;
  readonly sourceTextOffset?: number;
}

export interface RitoCoreWasmPaintRubyCommand extends RitoCoreWasmTextPaintCommand {
  readonly kind: 'paintRuby';
}

export interface RitoCoreWasmTextPaintCommand {
  readonly text: string;
  readonly rect: RitoCoreWasmRect;
  readonly paint: RitoCoreWasmRunPaint;
}

export interface RitoCoreWasmPaintImageCommand {
  readonly kind: 'paintImage';
  readonly src: string;
  readonly rect: RitoCoreWasmRect;
  readonly alt?: string;
  readonly href?: string;
  /** Raster-pixel subregion to sample; absent samples the whole raster. */
  readonly sourceRect?: RitoCoreWasmRect;
}

export interface RitoCoreWasmPaintHorizontalRuleCommand {
  readonly kind: 'paintHorizontalRule';
  readonly rect: RitoCoreWasmRect;
  readonly paint: RitoCoreWasmHorizontalRulePaint;
}

export interface RitoCoreWasmRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RitoCoreWasmPoint {
  readonly x: number;
  readonly y: number;
}

export interface RitoCoreWasmSize {
  readonly width: number;
  readonly height: number;
}

export interface RitoCoreWasmResolvedRadius {
  readonly rx: number;
  readonly ry: number;
}

export type RitoCoreWasmTransformFn =
  | RitoCoreWasmTranslateTransform
  | RitoCoreWasmScaleTransform
  | RitoCoreWasmRotateTransform;

export interface RitoCoreWasmTranslateTransform {
  readonly kind: 'translate';
  readonly x: RitoCoreWasmLengthPct;
  readonly y: RitoCoreWasmLengthPct;
}

export interface RitoCoreWasmScaleTransform {
  readonly kind: 'scale';
  readonly sx: number;
  readonly sy: number;
}

export interface RitoCoreWasmRotateTransform {
  readonly kind: 'rotate';
  readonly rad: number;
}

export type RitoCoreWasmLengthPct =
  | { readonly unit: 'px'; readonly value: number }
  | { readonly unit: 'percent'; readonly value: number };

export interface RitoCoreWasmPagePaint {
  readonly backgroundColor?: string;
}

export interface RitoCoreWasmBlockDecorationPaint {
  readonly background?: RitoCoreWasmBlockBackgroundPaint;
  readonly border?: RitoCoreWasmBlockBorderPaint;
  readonly radius?: RitoCoreWasmBlockRadius;
  readonly boxShadow?: readonly RitoCoreWasmBoxShadow[];
}

export interface RitoCoreWasmBlockBackgroundPaint {
  readonly color?: string;
  readonly image?: string;
  readonly size?: RitoCoreWasmBackgroundSize;
  readonly repeat?: 'repeat' | 'no-repeat';
  readonly position?: RitoCoreWasmBackgroundPosition;
}

export type RitoCoreWasmBackgroundSize =
  | 'cover'
  | 'contain'
  | 'auto'
  | RitoCoreWasmExplicitBackgroundSize;

export interface RitoCoreWasmExplicitBackgroundSize {
  readonly x: RitoCoreWasmBackgroundSizeAxis;
  readonly y: RitoCoreWasmBackgroundSizeAxis;
}

export type RitoCoreWasmBackgroundSizeAxis = 'auto' | RitoCoreWasmLengthPct;

export interface RitoCoreWasmBackgroundPosition {
  readonly x: RitoCoreWasmLengthPct;
  readonly y: RitoCoreWasmLengthPct;
}

export interface RitoCoreWasmBlockBorderPaint {
  readonly top?: RitoCoreWasmBorderPaintEdge;
  readonly right?: RitoCoreWasmBorderPaintEdge;
  readonly bottom?: RitoCoreWasmBorderPaintEdge;
  readonly left?: RitoCoreWasmBorderPaintEdge;
}

export interface RitoCoreWasmBorderPaintEdge {
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed' | 'double';
}

export interface RitoCoreWasmBlockRadius {
  readonly px?: number;
  readonly pct?: number;
  /**
   * Circular corner radii in CSS order (top-left, top-right,
   * bottom-right, bottom-left) for boxes whose corners disagree.
   */
  readonly corners?: readonly [number, number, number, number];
}

export interface RitoCoreWasmBoxShadow {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: string;
  readonly inset: boolean;
}

export interface RitoCoreWasmBorderBox {
  readonly topWidth: number;
  readonly rightWidth: number;
  readonly bottomWidth: number;
  readonly leftWidth: number;
}

export interface RitoCoreWasmRunPaint {
  readonly color: string;
  readonly font: RitoCoreWasmFontShorthand;
  readonly wordSpacingPx?: number;
  readonly letterSpacingPx?: number;
  readonly backgroundColor?: string;
  readonly backgroundRadius?: number;
  readonly textShadow?: readonly RitoCoreWasmTextShadow[];
  readonly decoration?: RitoCoreWasmRunDecoration;
  readonly padding?: RitoCoreWasmSpacing;
  readonly border?: RitoCoreWasmRunBorder;
  /** Pre-snapped vertical extent of the run's decorated inline box, as
   * offsets from the run rect's top. The layout side rounds the box to
   * device rows; the painter uses these instead of deriving the box
   * from font metrics. */
  readonly box?: RitoCoreWasmRunBox;
}

export interface RitoCoreWasmRunBox {
  readonly topPx: number;
  readonly bottomPx: number;
}

export interface RitoCoreWasmFontShorthand {
  readonly style: 'normal' | 'italic';
  readonly weight: number;
  readonly sizePx: number;
  readonly family: string;
}

export interface RitoCoreWasmTextShadow {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
  readonly color: string;
}

export type RitoCoreWasmRunDecoration =
  | RitoCoreWasmUnderlineDecoration
  | RitoCoreWasmLineThroughDecoration;

export interface RitoCoreWasmUnderlineDecoration extends RitoCoreWasmDecorationPaint {
  readonly kind: 'underline';
}

export interface RitoCoreWasmLineThroughDecoration extends RitoCoreWasmDecorationPaint {
  readonly kind: 'line-through';
}

export interface RitoCoreWasmDecorationPaint {
  readonly y: number;
  readonly thickness: number;
  readonly color: string;
}

export interface RitoCoreWasmSpacing {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface RitoCoreWasmRunBorder {
  readonly top?: RitoCoreWasmRunBorderEdge;
  readonly bottom?: RitoCoreWasmRunBorderEdge;
  readonly start?: RitoCoreWasmRunBorderEdge;
  readonly end?: RitoCoreWasmRunBorderEdge;
}

export interface RitoCoreWasmRunBorderEdge {
  readonly widthPx: number;
  readonly paint: RitoCoreWasmBorderPaintEdge;
}

export interface RitoCoreWasmHorizontalRulePaint {
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed' | 'double';
}
