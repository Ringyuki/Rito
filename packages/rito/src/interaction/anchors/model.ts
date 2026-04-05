/**
 * Anchor model types for source-anchored annotations.
 * Based on W3C Web Annotation selectors and Readium Locator architecture.
 */

/** A precise point in a chapter's parsed source tree. */
export interface SourcePoint {
  /** Path from chapter root to the text node. */
  readonly nodePath: readonly number[];
  /** Character offset within the text node. */
  readonly textOffset: number;
}

/** Structural anchor in Rito's parsed XHTML tree. Canonical internal selector. */
export interface SourceRangeSelector {
  readonly type: 'SourceRangeSelector';
  readonly start: SourcePoint;
  readonly end: SourcePoint;
}

/** Text content anchor with disambiguation context. W3C Web Annotation aligned. */
export interface TextQuoteSelector {
  readonly type: 'TextQuoteSelector';
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

/** Character offset range within normalized chapter text. */
export interface TextPositionSelector {
  readonly type: 'TextPositionSelector';
  readonly start: number;
  readonly end: number;
}

/** Coarse reading progression for last-resort fallback. */
export interface ProgressionSelector {
  readonly type: 'ProgressionSelector';
  /** Chapter index in spine order (0-based). */
  readonly chapter: number;
  /** Fractional progress within the chapter (0–1). */
  readonly chapterProgress: number;
}

/** All selectors for an annotation target, used in resolution order. */
export interface AnnotationSelectors {
  readonly sourceRange: SourceRangeSelector;
  readonly textQuote: TextQuoteSelector;
  readonly textPosition: TextPositionSelector;
  readonly progression: ProgressionSelector;
}

/** Highlighted text context for UI display and fallback matching. */
export interface LocatorTextContext {
  readonly highlight: string;
  readonly before?: string;
  readonly after?: string;
}

/** Complete anchor target for a persistent annotation. */
export interface AnnotationTarget {
  /** Chapter href (spine item) this annotation belongs to. */
  readonly href: string;
  readonly selectors: AnnotationSelectors;
  readonly text: LocatorTextContext;
}
