import type { RitoReaderRect } from './reader-session-display';
import type {
  RitoReaderLocator,
  RitoReaderSourcePoint,
  RitoReaderSourceRange,
} from './reader-session';

/** A position in a page's laid-out text; `charIndex` counts UTF-16 code units. */
export interface RitoReaderTextPosition {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly charIndex: number;
}

export type RitoReaderFootnoteKind = 'footnote' | 'endnote' | 'rearnote' | 'note';

/** `RITOFTN1`: a footnote a live artifact references. */
export interface RitoReaderFootnote {
  readonly artifactId: bigint;
  readonly key: string;
  readonly kind: RitoReaderFootnoteKind;
  readonly text: string;
  readonly html: string;
}

/** `RITOSRQ1`. A zero `limit` is unbounded. */
export interface RitoReaderSearchRequest {
  readonly sessionId: bigint;
  readonly artifactId: bigint;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly limit: number;
}

export interface RitoReaderSearchResult {
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly start: RitoReaderTextPosition;
  readonly end: RitoReaderTextPosition;
  readonly context: string;
  /** Durable source anchor; absent only when no part of the match has a source. */
  readonly locator?: RitoReaderLocator | undefined;
}

/** `RITOSRS1`. */
export interface RitoReaderSearchResponse {
  readonly artifactId: bigint;
  readonly query: string;
  readonly truncated: boolean;
  readonly searchedPageCount: number;
  readonly results: readonly RitoReaderSearchResult[];
}

/** `RITOTRQ1`: where a text range sits on one page. */
export interface RitoReaderTextRangeRequest {
  readonly sessionId: bigint;
  readonly artifactId: bigint;
  readonly pageIndex: number;
  readonly start: RitoReaderTextPosition;
  readonly end: RitoReaderTextPosition;
}

/** One run-aligned rectangle, in the artifact's display-list space. */
export interface RitoReaderTextRect {
  readonly bounds: RitoReaderRect;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly startCharIndex: number;
  readonly endCharIndex: number;
}

/** `RITOTRG1`. */
export interface RitoReaderTextRangeGeometry {
  readonly artifactId: bigint;
  readonly pageIndex: number;
  readonly rects: readonly RitoReaderTextRect[];
}

/** `RITOESQ1`: where a durable source range lands on an artifact's pages. */
export interface RitoReaderExactSourceRangeRequest {
  readonly sessionId: bigint;
  readonly artifactId: bigint;
  readonly href: string;
  readonly range: RitoReaderSourceRange;
}

export interface RitoReaderPageTextRect extends RitoReaderTextRect {
  readonly pageIndex: number;
}

/** `RITOESR1`. */
export interface RitoReaderExactSourceRangeResolution {
  readonly artifactId: bigint;
  readonly status: 'resolved' | 'pending' | 'unavailable';
  /** The page the range starts on, present whenever it resolved. */
  readonly firstPageIndex?: number | undefined;
  readonly selectedText: string;
  /** Only the pages this artifact draws. */
  readonly rects: readonly RitoReaderPageTextRect[];
}

export interface RitoReaderTextPoint {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
}

export interface RitoReaderCaretAddress {
  readonly pageIndex: number;
  readonly position: RitoReaderTextPosition;
  readonly affinity: 'upstream' | 'downstream';
}

export type RitoReaderSelectionMovement =
  | 'character-left'
  | 'character-right'
  | 'word-left'
  | 'word-right'
  | 'word-start-right'
  | 'line-up'
  | 'line-down'
  | 'line-start'
  | 'line-end'
  | 'page-up'
  | 'page-down'
  | 'paragraph-backward'
  | 'paragraph-forward'
  | 'paragraph-previous-start'
  | 'paragraph-next-start'
  | 'chapter-start'
  | 'chapter-end'
  | 'document-start'
  | 'document-end';

/** The five selection questions a browser reader asks, as one session operation. */
export type RitoReaderTextInteractionQuery =
  | { readonly kind: 'caret'; readonly point: RitoReaderTextPoint }
  | {
      readonly kind: 'range';
      readonly anchor: RitoReaderCaretAddress;
      readonly focus: RitoReaderCaretAddress;
    }
  | {
      readonly kind: 'range-to-point';
      readonly anchor: RitoReaderCaretAddress;
      readonly focus: RitoReaderTextPoint;
    }
  | {
      readonly kind: 'range-from-points';
      readonly anchor: RitoReaderTextPoint;
      readonly focus: RitoReaderTextPoint;
      readonly granularity: 'word' | 'paragraph';
    }
  | {
      readonly kind: 'movement';
      readonly anchor: RitoReaderCaretAddress;
      readonly focus: RitoReaderCaretAddress;
      readonly movement: RitoReaderSelectionMovement;
      readonly preferredInlinePosition?: number | undefined;
      readonly preferredBlockPosition?: number | undefined;
    };

/** `RITOTIQ1`. */
export interface RitoReaderTextInteractionRequest {
  readonly sessionId: bigint;
  readonly artifactId: bigint;
  readonly query: RitoReaderTextInteractionQuery;
}

export interface RitoReaderCaret {
  readonly address: RitoReaderCaretAddress;
  readonly geometry?:
    | { readonly x: number; readonly y: number; readonly height: number }
    | undefined;
  readonly href: string;
  readonly sourcePoint: RitoReaderSourcePoint;
}

export interface RitoReaderTextSelection {
  readonly anchor: RitoReaderCaretAddress;
  readonly focus: RitoReaderCaretAddress;
  readonly start: RitoReaderCaretAddress;
  readonly end: RitoReaderCaretAddress;
  readonly selectedText: string;
  readonly sourceStartHref: string;
  readonly sourceStart: RitoReaderSourcePoint;
  readonly sourceEndHref: string;
  readonly sourceEnd: RitoReaderSourcePoint;
  readonly rects: readonly RitoReaderPageTextRect[];
}

export type RitoReaderTextInteractionUnavailableReason =
  | 'shape-unavailable'
  | 'source-unavailable'
  | 'unsupported-transform'
  | 'visual-geometry-unavailable'
  | 'invalid-caret'
  | 'different-chapter';

export type RitoReaderTextInteractionResult =
  | { readonly kind: 'caret'; readonly caret: RitoReaderCaret }
  | {
      readonly kind: 'selection';
      readonly anchorCaret?: RitoReaderCaret | undefined;
      readonly focusCaret?: RitoReaderCaret | undefined;
      readonly selection: RitoReaderTextSelection;
      readonly preferredInlinePosition?: number | undefined;
      readonly preferredBlockPosition?: number | undefined;
    }
  | { readonly kind: 'miss' }
  | { readonly kind: 'boundary'; readonly boundary: 'start' | 'end' }
  | { readonly kind: 'pending'; readonly boundary: 'start' | 'end' }
  | { readonly kind: 'unavailable'; readonly reason: RitoReaderTextInteractionUnavailableReason };

/** `RITOTIR1`. */
export interface RitoReaderTextInteractionResponse {
  readonly artifactId: bigint;
  readonly result: RitoReaderTextInteractionResult;
}

/** `RITOANQ1`: build a target for a source range, or locate a stored one by its JSON. */
export interface RitoReaderAnnotationRequest {
  readonly sessionId: bigint;
  readonly query:
    | { readonly kind: 'create'; readonly href: string; readonly range: RitoReaderSourceRange }
    | { readonly kind: 'resolve'; readonly targetJson: string };
}

/**
 * The engine's annotation target: `json` is the canonical serialization a
 * host persists byte for byte; the other fields are its decoded contents.
 */
export interface RitoReaderAnnotationTarget {
  readonly json: string;
  readonly href: string;
  readonly sourceRange: RitoReaderSourceRange;
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly start: bigint;
  readonly end: bigint;
  readonly chapterLength: bigint;
}

export type RitoReaderAnnotationLevel =
  | 'created'
  | 'exact'
  | 'quote'
  | 'position'
  | 'progression'
  | 'orphaned-href-not-found'
  | 'orphaned-empty-chapter';

/** `RITOANR1`: `target` is absent exactly for the orphaned levels. */
export interface RitoReaderAnnotationResponse {
  readonly level: RitoReaderAnnotationLevel;
  readonly target?: RitoReaderAnnotationTarget | undefined;
}

/** `RITONVQ1`: a reading-position question. */
export interface RitoReaderNavigationRequest {
  readonly sessionId: bigint;
  readonly query:
    | {
        readonly kind: 'toc-entry-at-page';
        readonly artifactId: bigint;
        readonly pageIndex: number;
      }
    | {
        readonly kind: 'toc-entry-at-position';
        readonly href: string;
        readonly point: RitoReaderSourcePoint;
      }
    | { readonly kind: 'locate'; readonly artifactId: bigint; readonly locator: RitoReaderLocator }
    | {
        readonly kind: 'compare';
        readonly firstHref: string;
        readonly first: RitoReaderSourcePoint;
        readonly secondHref: string;
        readonly second: RitoReaderSourcePoint;
      };
}

export type RitoReaderLocation =
  | {
      readonly kind: 'page';
      readonly pageIndex: number;
      /** Whether the asking artifact draws that page. */
      readonly drawn: boolean;
      readonly matchedBy: 'source-range' | 'source-point' | 'anchor' | 'progression' | 'href';
    }
  | { readonly kind: 'not-laid-out' }
  | { readonly kind: 'unavailable' };

/** `RITONVR1`. A TOC entry is named by its preorder `tocId`. */
export type RitoReaderNavigationResult =
  | { readonly kind: 'toc-entry'; readonly tocId?: number | undefined }
  | { readonly kind: 'location'; readonly location: RitoReaderLocation }
  | { readonly kind: 'order'; readonly order: -1 | 0 | 1 };
