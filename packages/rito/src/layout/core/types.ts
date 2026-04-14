// Layout types. No Canvas API dependency.

import type { SourceRef } from '../../parser/xhtml/types';
import type { BlockPaint, BorderBox, HrPaint, PagePaint, RunPaint } from './paint';

export type {
  BlockBackgroundPaint,
  BlockBorderPaint,
  BlockPaint,
  BlockRadius,
  BorderBox,
  HrPaint,
  PagePaint,
  RunBorder,
  RunBorderEdge,
  RunDecoration,
  RunPaint,
  Spacing,
} from './paint';

/** Represents a rectangular region in layout space. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A laid-out text run within a line. */
export interface TextRun {
  readonly type: 'text-run';
  readonly text: string;
  readonly bounds: Rect;
  readonly paint: RunPaint;
  readonly href?: string;
  readonly sourceRef?: SourceRef;
  readonly sourceText?: string;
  /** Offset of this run's first character within the source text node. */
  readonly sourceTextOffset?: number;
  /** Trailing inline margin-right (from the inline element wrapping this run). */
  readonly inlineMarginRight?: number;
  /**
   * Present when CSS `line-height` was an absolute value (px/em/rem/%). Used
   * by the line-box metrics pass to compute half-leading against the run's
   * font-size. Absent = line-height is the multiplier already factored into
   * `bounds.height`.
   */
  readonly lineHeightPx?: number;
}

/** A ruby annotation rendered above a span of base text. Produced as a
 *  standalone LineBox child whose bounds are already positioned absolutely
 *  above the base group it annotates. */
export interface RubyAnnotation {
  readonly type: 'ruby-annotation';
  readonly text: string;
  readonly bounds: Rect;
  readonly paint: RunPaint;
}

/** An atomic inline unit (inline-block or inline image) within a line. */
export interface InlineAtom {
  readonly type: 'inline-atom';
  readonly bounds: Rect;
  readonly imageSrc?: string;
  /** Nested layout block for inline-block elements. Reserved for future use. */
  readonly block?: LayoutBlock;
  readonly href?: string;
  readonly alt?: string;
}

/** A laid-out line box containing text runs, inline atoms, and ruby labels. */
export interface LineBox {
  readonly type: 'line-box';
  readonly bounds: Rect;
  readonly runs: readonly (TextRun | InlineAtom | RubyAnnotation)[];
}

/** A laid-out image element. */
export interface ImageElement {
  readonly type: 'image';
  readonly src: string;
  readonly alt?: string;
  /** Hyperlink from a parent `<a>` element wrapping this image. */
  readonly href?: string;
  readonly bounds: Rect;
}

/** A horizontal rule element. */
export interface HorizontalRule {
  readonly type: 'hr';
  readonly bounds: Rect;
  readonly paint: HrPaint;
}

/** A laid-out block. The top-level fields are geometry + semantics +
 *  pagination; all render-only metadata (background, border paint, opacity,
 *  transform, shadow, clipping, visual offsets) lives on `paint`. */
export interface LayoutBlock {
  readonly type: 'layout-block';
  readonly bounds: Rect;
  readonly children: readonly (LineBox | LayoutBlock | ImageElement | HorizontalRule)[];
  readonly anchorId?: string;
  /** Source HTML tag name for semantic mapping (e.g. 'h1', 'p', 'blockquote'). */
  readonly semanticTag?: string;
  /** Physical border widths (geometry, already baked into bounds). */
  readonly borderBox?: BorderBox;
  readonly pageBreakBefore?: boolean;
  readonly pageBreakAfter?: boolean;
  /** Minimum lines before a page break (CSS orphans). */
  readonly orphans?: number;
  /** Minimum lines after a page break (CSS widows). */
  readonly widows?: number;
  /** Render-only paint aggregate. Absent = no decoration beyond geometry. */
  readonly paint?: BlockPaint;
}

/** Runtime pagination policy for widow/orphan control. */
export interface PaginationPolicy {
  /** Whether to enforce widow/orphan constraints. Defaults to true. */
  readonly enabled?: boolean;
  /** Default orphans value when CSS doesn't specify. Defaults to 2. */
  readonly defaultOrphans?: number;
  /** Default widows value when CSS doesn't specify. Defaults to 2. */
  readonly defaultWidows?: number;
}

/**
 * Configuration for page dimensions, margins, and display mode.
 * All dimensional values are in logical pixels.
 *
 * `viewportWidth` and `viewportHeight` are the hard canvas constraints.
 * `pageWidth` and `pageHeight` are derived from the viewport and spread mode.
 */
export interface LayoutConfig {
  /** Total viewport (canvas) width. */
  readonly viewportWidth: number;
  /** Total viewport (canvas) height. */
  readonly viewportHeight: number;
  /** Derived page width (viewport width in single mode, half minus gap in double). */
  readonly pageWidth: number;
  /** Derived page height (same as viewport height). */
  readonly pageHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  /** Effective display mode (may differ from requested if viewport is portrait). */
  readonly spreadMode: 'single' | 'double';
  /** If true, the first page (cover) stands alone in its own spread. */
  readonly firstPageAlone: boolean;
  /** Gap in pixels between left and right pages in double mode. */
  readonly spreadGap: number;
  /** Root font size in px, used to resolve rem units. Defaults to 16. */
  readonly rootFontSize: number;
  /** Global line-height multiplier override. When set, overrides CSS line-height on body. */
  readonly lineHeightOverride?: number | undefined;
  /** Global font-family override. When set, overrides CSS font-family on body. */
  readonly fontFamilyOverride?: string | undefined;
  /** Runtime pagination policy for widow/orphan control. */
  readonly paginationPolicy?: PaginationPolicy | undefined;
}

/**
 * A computed page of content ready for rendering.
 * Produced by {@link paginateBlocks} or {@link paginate}.
 */
export interface Page {
  /** Zero-based page index. */
  readonly index: number;
  /** Full page dimensions (including margins). */
  readonly bounds: Rect;
  /** Layout blocks positioned within the page content area. */
  readonly content: readonly LayoutBlock[];
  /** Render-only page-level paint (per-chapter body background etc). */
  readonly paint?: PagePaint;
}

/** A presentation-layer grouping of 1-2 pages for side-by-side display. */
export interface Spread {
  /** Zero-based spread index. */
  readonly index: number;
  /** Left page (or the only page in single mode). */
  readonly left?: Page;
  /** Right page (only in double mode). */
  readonly right?: Page;
}
