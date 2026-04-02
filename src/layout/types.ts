/**
 * Layout computation types.
 * Layout must not depend on Canvas APIs.
 */

import type { Rect } from '../model/types';
import type { ComputedStyle } from '../style/types';

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

/** A laid-out block containing line boxes or nested blocks. */
export interface LayoutBlock {
  readonly type: 'layout-block';
  readonly bounds: Rect;
  readonly children: readonly (LineBox | LayoutBlock)[];
}

/**
 * Configuration for page dimensions and margins.
 * All values are in logical pixels.
 */
export interface LayoutConfig {
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
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
