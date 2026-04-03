// Layout types. No Canvas API dependency.

import type { ComputedStyle } from '../style/types';

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
}

/** A laid-out line box containing text runs. */
export interface LineBox {
  readonly type: 'line-box';
  readonly bounds: Rect;
  readonly runs: readonly TextRun[];
}

/** A laid-out image element. */
export interface ImageElement {
  readonly type: 'image';
  readonly src: string;
  readonly bounds: Rect;
}

/** A horizontal rule element. */
export interface HorizontalRule {
  readonly type: 'hr';
  readonly bounds: Rect;
  readonly color: string;
}

/** A laid-out block containing line boxes, nested blocks, images, or horizontal rules. */
export interface LayoutBlock {
  readonly type: 'layout-block';
  readonly bounds: Rect;
  readonly children: readonly (LineBox | LayoutBlock | ImageElement | HorizontalRule)[];
  readonly anchorId?: string;
  readonly backgroundColor?: string;
  readonly borders?: BlockBorders;
  readonly pageBreakBefore?: boolean;
  readonly pageBreakAfter?: boolean;
}

/** Border widths and colors for a layout block. */
export interface BlockBorders {
  readonly top: { readonly width: number; readonly color: string };
  readonly right: { readonly width: number; readonly color: string };
  readonly bottom: { readonly width: number; readonly color: string };
  readonly left: { readonly width: number; readonly color: string };
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