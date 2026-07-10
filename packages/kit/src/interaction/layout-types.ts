import type {
  ChapterRange as CoreChapterRange,
  ChapterTextIndex as CoreChapterTextIndex,
  ChapterTextSpan as CoreChapterTextSpan,
  LayoutConfig as CoreLayoutConfig,
  MeasurePaint,
  Page as CorePage,
  Rect as CoreRect,
  Spread as CoreSpread,
  TextMeasurer as CoreTextMeasurer,
} from '@ritojs/core';

export type Rect = CoreRect;
export type LayoutConfig = CoreLayoutConfig;
export type TextMeasurer = CoreTextMeasurer;
export type { MeasurePaint };
export type ChapterRange = CoreChapterRange;
export type ChapterTextIndex = CoreChapterTextIndex;
export type ChapterTextSpan = CoreChapterTextSpan;

export interface SourceRef {
  readonly nodePath: readonly number[];
}

export interface RunPaint {
  readonly color?: string;
  readonly font: MeasurePaint['font'];
  readonly wordSpacingPx?: number;
  readonly letterSpacingPx?: number;
}

export const DEFAULT_RUN_PAINT: RunPaint = {
  color: '#000000',
  font: { style: 'normal', weight: 400, sizePx: 16, family: 'serif' },
};

export interface TextRun {
  readonly type: 'text-run';
  readonly text: string;
  readonly bounds: Rect;
  readonly paint: RunPaint;
  readonly href?: string;
  readonly sourceRef?: SourceRef;
  readonly sourceText?: string;
  readonly sourceTextOffset?: number;
}

export interface RubyAnnotation {
  readonly type: 'ruby-annotation';
  readonly text: string;
  readonly bounds: Rect;
  readonly paint: RunPaint;
}

export interface InlineAtom {
  readonly type: 'inline-atom';
  readonly bounds: Rect;
  readonly imageSrc?: string;
  readonly block?: LayoutBlock;
  readonly href?: string;
  readonly alt?: string;
}

export interface LineBox {
  readonly type: 'line-box';
  readonly bounds: Rect;
  readonly runs: readonly (TextRun | InlineAtom | RubyAnnotation)[];
}

export interface ImageElement {
  readonly type: 'image';
  readonly src: string;
  readonly alt?: string;
  readonly href?: string;
  readonly bounds: Rect;
}

export interface HorizontalRule {
  readonly type: 'hr';
  readonly bounds: Rect;
}

export interface LayoutBlock {
  readonly type: 'layout-block';
  readonly bounds: Rect;
  readonly children: readonly (LineBox | LayoutBlock | ImageElement | HorizontalRule)[];
  readonly anchorId?: string;
  readonly semanticTag?: string;
}

export interface Page extends Omit<CorePage, 'content'> {
  readonly content: readonly LayoutBlock[];
}

export interface Spread extends Omit<CoreSpread, 'left' | 'right'> {
  readonly left?: Page;
  readonly right?: Page;
}

export interface TextNode {
  readonly type: 'text';
  readonly content: string;
  readonly sourceRef?: SourceRef;
}

export interface ParentDocumentNode {
  readonly type: 'block' | 'inline';
  readonly children: readonly DocumentNode[];
  readonly sourceRef?: SourceRef;
}

export interface ImageNode {
  readonly type: 'image';
  readonly src: string;
  readonly alt: string;
  readonly sourceRef?: SourceRef;
}

export type DocumentNode = TextNode | ParentDocumentNode | ImageNode;
