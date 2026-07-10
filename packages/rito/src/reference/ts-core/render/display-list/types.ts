import type {
  BorderBox,
  BlockBackgroundPaint,
  BlockBorderPaint,
  BlockPaint,
  BlockRadius,
  HrPaint,
  PagePaint,
  Rect,
  RunPaint,
} from '../../layout/core/types';
import type { TransformFn } from '../../style/core/paint-types';

/** A platform-neutral list of paint commands in logical page coordinates. */
export interface DisplayList {
  readonly width: number;
  readonly height: number;
  readonly commands: readonly DrawCommand[];
}

export type DrawCommand =
  | PushStateCommand
  | PopStateCommand
  | TranslateCommand
  | TransformCommand
  | OpacityCommand
  | ClipRectCommand
  | PaintPageCommand
  | PaintBlockCommand
  | PaintTextCommand
  | PaintRubyCommand
  | PaintImageCommand
  | PaintHorizontalRuleCommand;

export interface PushStateCommand {
  readonly kind: 'pushState';
}

export interface PopStateCommand {
  readonly kind: 'popState';
}

export interface TranslateCommand {
  readonly kind: 'translate';
  readonly dx: number;
  readonly dy: number;
}

export interface TransformCommand {
  readonly kind: 'transform';
  readonly origin: Point;
  readonly box: Size;
  readonly transforms: readonly TransformFn[];
}

export interface OpacityCommand {
  readonly kind: 'opacity';
  readonly value: number;
}

export interface ClipRectCommand {
  readonly kind: 'clipRect';
  readonly rect: Rect;
  readonly radius?: ResolvedRadius;
}

export interface PaintPageCommand {
  readonly kind: 'paintPage';
  readonly rect: Rect;
  readonly paint: PagePaint;
}

export interface PaintBlockCommand {
  readonly kind: 'paintBlock';
  readonly rect: Rect;
  readonly paint: BlockDecorationPaint;
  readonly borderBox?: BorderBox;
}

export type BlockDecorationPaint = Pick<
  BlockPaint,
  'background' | 'border' | 'radius' | 'boxShadow'
>;

export type { BlockBackgroundPaint, BlockBorderPaint, BlockRadius };

export interface PaintTextCommand {
  readonly kind: 'paintText';
  readonly text: string;
  readonly rect: Rect;
  readonly paint: RunPaint;
  readonly lineHeightPx?: number;
  readonly href?: string;
  readonly sourceText?: string;
  readonly sourceTextOffset?: number;
}

export interface PaintRubyCommand {
  readonly kind: 'paintRuby';
  readonly text: string;
  readonly rect: Rect;
  readonly paint: RunPaint;
}

export interface PaintImageCommand {
  readonly kind: 'paintImage';
  readonly src: string;
  readonly rect: Rect;
  readonly alt?: string;
  readonly href?: string;
}

export interface PaintHorizontalRuleCommand {
  readonly kind: 'paintHorizontalRule';
  readonly rect: Rect;
  readonly paint: HrPaint;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface ResolvedRadius {
  readonly rx: number;
  readonly ry: number;
}

export interface DisplayListOptions {
  readonly backgroundColor?: string;
  readonly foregroundColor?: string;
  readonly spreadBodyBg?: string;
}
