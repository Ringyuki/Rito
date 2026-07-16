export type RitoCoreWasmFootnoteKind = 'footnote' | 'endnote' | 'rearnote' | 'note';

export interface RitoCoreWasmFootnote {
  readonly revisionId: string;
  readonly key: string;
  readonly kind: RitoCoreWasmFootnoteKind;
  readonly text: string;
  readonly html: string;
}

export interface RitoCoreWasmFootnoteEntry {
  readonly kind: RitoCoreWasmFootnoteKind;
  readonly text: string;
  readonly html: string;
}

export interface RitoCoreWasmFootnotes {
  readonly revisionId: string;
  readonly entries: Readonly<Record<string, RitoCoreWasmFootnoteEntry>>;
}

export interface RitoCoreWasmChapterTextSpan {
  readonly nodePath: readonly number[];
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
}

export interface RitoCoreWasmChapterTextIndex {
  readonly href: string;
  readonly normalizedText: string;
  readonly spans: readonly RitoCoreWasmChapterTextSpan[];
}

export interface RitoCoreWasmChapterTextIndices {
  readonly revisionId: string;
  readonly entries: Readonly<Record<string, RitoCoreWasmChapterTextIndex>>;
}

export interface RitoCoreWasmSourcePoint {
  readonly nodePath: readonly number[];
  /** UTF-16 code-unit offset within the parsed XHTML text node. */
  readonly textOffset: number;
}

export interface RitoCoreWasmSourceRange {
  readonly start: RitoCoreWasmSourcePoint;
  /** End-exclusive source boundary. */
  readonly end: RitoCoreWasmSourcePoint;
}

/** Durable exact range read against one retained Rust layout revision. */
export interface RitoCoreWasmExactSourceRangeRequest {
  /** Canonical manifest href without a fragment. */
  readonly href: string;
  readonly sourceRange: RitoCoreWasmSourceRange;
}

export interface RitoCoreWasmSourceLocator {
  readonly href: string;
  readonly anchorId?: string | undefined;
  readonly sourcePoint?: RitoCoreWasmSourcePoint | undefined;
  readonly sourceRange?: RitoCoreWasmSourceRange | undefined;
  readonly progression?: number | undefined;
}

export type RitoCoreWasmTextCaretAffinity = 'upstream' | 'downstream';

/**
 * Exact shaped-caret address inside one Rust layout revision.
 *
 * The wire value deliberately does not embed revision identity. Callers that
 * cache it must retain the owning reader `sessionId` and complete
 * `{ revisionId, revisionVersion }` handle alongside it. Detached addresses
 * must not be combined across sessions or handles. A bounded stable-prefix
 * advance may rebind an address only through an explicit higher-layer policy.
 */
export interface RitoCoreWasmTextCaretAddress {
  readonly pageIndex: number;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  /** Run-local UTF-16 offset at an authoritative shaped cluster edge. */
  readonly charIndex: number;
  readonly affinity: RitoCoreWasmTextCaretAffinity;
}

export interface RitoCoreWasmTextPointRequest {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
}

export interface RitoCoreWasmTextCaretGeometry {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

export type RitoCoreWasmTextInteractionUnavailableReason =
  | 'shapeUnavailable'
  | 'sourceUnavailable'
  | 'unsupportedTransform'
  | 'visualGeometryUnavailable'
  | 'invalidCaret'
  | 'differentChapter';

export interface RitoCoreWasmTextCaret {
  readonly address: RitoCoreWasmTextCaretAddress;
  readonly geometry: RitoCoreWasmTextCaretGeometry;
  readonly sourceLocator: RitoCoreWasmSourceLocator;
}

export type RitoCoreWasmTextCaretResolution =
  | { readonly status: 'resolved'; readonly caret: RitoCoreWasmTextCaret }
  | {
      readonly status: 'unavailable';
      readonly reason: RitoCoreWasmTextInteractionUnavailableReason;
    }
  | { readonly status: 'miss' };

export interface RitoCoreWasmTextCaretResponse {
  readonly revisionId: string;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly resolution: RitoCoreWasmTextCaretResolution;
}

export interface RitoCoreWasmTextRangeRequest {
  readonly anchor: RitoCoreWasmTextCaretAddress;
  readonly focus: RitoCoreWasmTextCaretAddress;
}

export interface RitoCoreWasmExactTextRangeRect {
  readonly pageIndex: number;
  readonly spreadIndex: number;
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

export interface RitoCoreWasmExactSourceRange {
  readonly selectedText: string;
  readonly sourceLocator: RitoCoreWasmSourceLocator;
  readonly rects: readonly RitoCoreWasmExactTextRangeRect[];
}

export type RitoCoreWasmExactSourceRangeResolution =
  | { readonly status: 'resolved'; readonly range: RitoCoreWasmExactSourceRange }
  | {
      readonly status: 'pending';
      readonly reason: 'notPaginated' | 'noPageProjection';
    }
  | {
      readonly status: 'unavailable';
      readonly reason: RitoCoreWasmTextInteractionUnavailableReason;
    };

export interface RitoCoreWasmExactSourceRangeResponse {
  readonly revisionId: string;
  readonly resolution: RitoCoreWasmExactSourceRangeResolution;
}

export interface RitoCoreWasmTextRange {
  readonly anchor: RitoCoreWasmTextCaretAddress;
  readonly focus: RitoCoreWasmTextCaretAddress;
  readonly start: RitoCoreWasmTextCaretAddress;
  readonly end: RitoCoreWasmTextCaretAddress;
  readonly selectedText: string;
  readonly sourceLocator: RitoCoreWasmSourceLocator;
  readonly rects: readonly RitoCoreWasmExactTextRangeRect[];
}

export type RitoCoreWasmTextRangeResolution =
  | { readonly status: 'resolved'; readonly range: RitoCoreWasmTextRange }
  | {
      readonly status: 'unavailable';
      readonly reason: RitoCoreWasmTextInteractionUnavailableReason;
    };

export interface RitoCoreWasmTextRangeResponse {
  readonly revisionId: string;
  readonly resolution: RitoCoreWasmTextRangeResolution;
}

export type RitoCoreWasmTextSelectionGranularity = 'word' | 'paragraph';

export interface RitoCoreWasmTextRangeFromPointsRequest {
  readonly anchor: RitoCoreWasmTextPointRequest;
  readonly focus: RitoCoreWasmTextPointRequest;
  readonly granularity: RitoCoreWasmTextSelectionGranularity;
}

export type RitoCoreWasmTextRangeFromPointsResolution =
  | {
      readonly status: 'resolved';
      readonly anchorCaret: RitoCoreWasmTextCaret;
      readonly focusCaret: RitoCoreWasmTextCaret;
      readonly range: RitoCoreWasmTextRange;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: RitoCoreWasmTextInteractionUnavailableReason;
    }
  | { readonly status: 'miss' };

export interface RitoCoreWasmTextRangeFromPointsResponse {
  readonly revisionId: string;
  readonly resolution: RitoCoreWasmTextRangeFromPointsResolution;
}

export type RitoCoreWasmSourceLocatorMatchedBy =
  | 'sourceRange'
  | 'sourcePoint'
  | 'anchor'
  | 'progression'
  | 'href';

export type RitoCoreWasmSourceLocatorResolution =
  | {
      readonly status: 'resolved';
      readonly revisionId: string;
      readonly locator: RitoCoreWasmSourceLocator;
      readonly spineIdref: string;
      readonly pageIndex: number;
      readonly spreadIndex: number;
      readonly matchedBy: RitoCoreWasmSourceLocatorMatchedBy;
    }
  | {
      readonly status: 'pending';
      readonly revisionId: string;
      readonly locator: RitoCoreWasmSourceLocator;
      readonly spineIdref: string;
      readonly reason: 'notPaginated' | 'noPageProjection';
      readonly matchedBy: RitoCoreWasmSourceLocatorMatchedBy;
    };
