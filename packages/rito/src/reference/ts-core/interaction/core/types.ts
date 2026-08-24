import type { Rect } from '../../layout/core/types';
import type { SourceRef } from '../../parser/xhtml/types';
import type { MeasurePaint } from '../../style/core/paint-types';

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

/** A rectangular region mapped to content within a page. Bounds are in page-content space. */
export interface HitEntry {
  readonly bounds: Rect;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly text: string;
  /** Minimal paint subset the measurer needs to resolve char positions.
   *  Absent on non-text entries (inline atoms, block images). */
  readonly measure?: MeasurePaint;
  readonly href?: string;
  readonly sourceRef?: SourceRef;
  readonly sourceText?: string;
  /** Offset of this entry's first character within the source text node. */
  readonly sourceTextOffset?: number;
  /** Image source (for inline or block-level images). */
  readonly imageSrc?: string;
  /** Image alt text. */
  readonly imageAlt?: string;
}

/** Precomputed coordinate-to-content mapping for a page. */
export interface HitMap {
  readonly entries: readonly HitEntry[];
  readonly pageIndex: number;
}

/** A hyperlink region within a page. Bounds are in page-content space. */
export interface LinkRegion {
  readonly bounds: Rect;
  readonly href: string;
  readonly text: string;
}
