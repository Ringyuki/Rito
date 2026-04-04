import type { Rect } from '../../layout/core/types';
import type { ComputedStyle } from '../../style/core/types';

/** A position within the text content of a page. */
export interface TextPosition {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly charIndex: number;
}

/** A range of text between two positions. */
export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

/** A rectangular region mapped to content within a page. */
export interface HitEntry {
  readonly bounds: Rect;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly text: string;
  readonly style: ComputedStyle;
  readonly href?: string;
}

/** Precomputed coordinate-to-content mapping for a page. */
export interface HitMap {
  readonly entries: readonly HitEntry[];
  readonly pageIndex: number;
}

/** A hyperlink region within a page. */
export interface LinkRegion {
  readonly bounds: Rect;
  readonly href: string;
  readonly text: string;
}
