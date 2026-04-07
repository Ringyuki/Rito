// Layout types. No Canvas API dependency.

import type { SourceRef } from '../../parser/xhtml/types';
import type { BoxShadow, ComputedStyle } from '../../style/core/types';

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
  readonly style: ComputedStyle;
  readonly href?: string;
  readonly sourceRef?: SourceRef;
  readonly sourceText?: string;
  /** Offset of this run's first character within the source text node. */
  readonly sourceTextOffset?: number;
}

/** An atomic inline unit (inline-block or inline image) within a line. */
export interface InlineAtom {
  readonly type: 'inline-atom';
  readonly bounds: Rect;
  readonly imageSrc?: string;
  /**
   * Nested layout block for inline-block elements.
   * Currently unused — reserved for future inline-block content rendering.
   */
  readonly block?: LayoutBlock;
  readonly verticalAlign?: string;
  readonly href?: string;
  readonly alt?: string;
}

/** A laid-out line box containing text runs and inline atoms. */
export interface LineBox {
  readonly type: 'line-box';
  readonly bounds: Rect;
  readonly runs: readonly (TextRun | InlineAtom)[];
}

/** A laid-out image element. */
export interface ImageElement {
  readonly type: 'image';
  readonly src: string;
  readonly alt?: string;
  readonly bounds: Rect;
}

/** A horizontal rule element. */
export interface HorizontalRule {
  readonly type: 'hr';
  readonly bounds: Rect;
  readonly color: string;
}

/** Visual offset for position:relative elements. */
export interface RelativeOffset {
  readonly dx: number;
  readonly dy: number;
}

/** A laid-out block containing line boxes, nested blocks, images, or horizontal rules. */
export interface LayoutBlock {
  readonly type: 'layout-block';
  readonly bounds: Rect;
  readonly children: readonly (LineBox | LayoutBlock | ImageElement | HorizontalRule)[];
  readonly anchorId?: string;
  /** Source HTML tag name for semantic mapping (e.g. 'h1', 'p', 'blockquote'). */
  readonly semanticTag?: string;
  readonly backgroundColor?: string;
  readonly borders?: BlockBorders;
  /** Border radius in px for rounded corners. Render-only. */
  readonly borderRadius?: number;
  /** Opacity (0-1) for the block. Render-only. */
  readonly opacity?: number;
  readonly pageBreakBefore?: boolean;
  readonly pageBreakAfter?: boolean;
  /** Visual offset from position:relative (does not affect layout flow). */
  readonly relativeOffset?: RelativeOffset;
  /** When 'hidden', the renderer clips children to block bounds. */
  readonly overflow?: 'hidden';
  /** Minimum lines before a page break (CSS orphans). */
  readonly orphans?: number;
  /** Minimum lines after a page break (CSS widows). */
  readonly widows?: number;
  /** Box shadows for the block. Render-only. */
  readonly boxShadow?: readonly BoxShadow[];
}

/** Border edge in a layout block. */
export interface BlockBorderEdge {
  readonly width: number;
  readonly color: string;
  readonly style: 'solid' | 'dotted' | 'dashed';
}

/** Border widths, colors, and styles for a layout block. */
export interface BlockBorders {
  readonly top: BlockBorderEdge;
  readonly right: BlockBorderEdge;
  readonly bottom: BlockBorderEdge;
  readonly left: BlockBorderEdge;
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
