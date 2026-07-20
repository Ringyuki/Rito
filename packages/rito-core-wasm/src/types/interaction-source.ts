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
  readonly complete: boolean;
  readonly pendingKeys: readonly string[];
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

export interface RitoCoreWasmTextSourceSpanEndpoint {
  readonly href: string;
  readonly sourcePoint: RitoCoreWasmSourcePoint;
}

export interface RitoCoreWasmTextSourceSpan {
  readonly start: RitoCoreWasmTextSourceSpanEndpoint;
  /** End-exclusive source boundary. */
  readonly end: RitoCoreWasmTextSourceSpanEndpoint;
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
