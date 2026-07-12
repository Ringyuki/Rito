import type { RitoCoreWasmSourceLocator } from './interaction';
import type { RitoCoreWasmSearchTextPosition } from './search';

export type RitoCoreWasmPageTargetKind = 'text' | 'link' | 'image' | 'footnote';

export interface RitoCoreWasmPageTargetBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RitoCoreWasmPageTargetText {
  readonly hash: string;
  /** UTF-16 code-unit length. */
  readonly length: number;
}

/** Paint-order semantic target in page-content coordinates. */
export interface RitoCoreWasmPageTarget {
  readonly kind: RitoCoreWasmPageTargetKind;
  readonly bounds: RitoCoreWasmPageTargetBounds;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly label: string;
  readonly text: RitoCoreWasmPageTargetText;
  /** Original EPUB href. */
  readonly href?: string | undefined;
  /** Canonical location of the clicked source node, when retained by layout. */
  readonly sourceLocator?: RitoCoreWasmSourceLocator | undefined;
  /** Canonical internal destination. External links deliberately omit it. */
  readonly targetLocator?: RitoCoreWasmSourceLocator | undefined;
  readonly imageSrc?: string | undefined;
  readonly imageAlt?: string | undefined;
  /** Exact canonical key in this revision's footnote table. */
  readonly footnoteKey?: string | undefined;
}

export interface RitoCoreWasmPageTargets {
  readonly revisionId: string;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly entryCount: number;
  readonly textHash: string;
  readonly entries: readonly RitoCoreWasmPageTarget[];
}

export interface RitoCoreWasmTextRunOffset {
  readonly start: number;
  readonly end: number;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
}

/**
 * Internal diagnostic projection of visual page text; not a precise selection contract.
 * Worker validation can verify its text/offset structure, not shaped caret legality.
 */
export interface RitoCoreWasmPageTextPositions {
  readonly revisionId: string;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly text: string;
  readonly textLength: number;
  /** Diagnostic checksum only; exact revision/request envelopes own identity. */
  readonly textHash: string;
  readonly offsets: readonly RitoCoreWasmTextRunOffset[];
}

/**
 * Internal diagnostic request. Character geometry is currently approximate;
 * charIndex is a UTF-16 count but this legacy request cannot prove shaped
 * caret legality or reject an interior grapheme/ligature position.
 */
export interface RitoCoreWasmTextRangeGeometryRequest {
  readonly pageIndex: number;
  readonly start: RitoCoreWasmSearchTextPosition;
  readonly end: RitoCoreWasmSearchTextPosition;
}

export interface RitoCoreWasmTextRangeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly startCharIndex: number;
  readonly endCharIndex: number;
}

/**
 * Internal diagnostic geometry; run slices currently use approximate interpolation.
 * Worker validation can bind the normalized request and require endpoint
 * coverage, but this legacy DTO carries no run text, run lengths or caret stops.
 */
export interface RitoCoreWasmTextRangeGeometry {
  readonly revisionId: string;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly rectCount: number;
  readonly rects: readonly RitoCoreWasmTextRangeRect[];
}
