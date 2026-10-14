export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export interface PackageMetadata {
  readonly title: string;
  readonly language: string;
  readonly identifier: string;
  readonly creator?: string;
}

export interface TocEntry {
  readonly label: string;
  readonly href: string;
  readonly children: readonly TocEntry[];
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutConfig {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly spreadMode: 'single' | 'double';
  readonly firstPageAlone: boolean;
  readonly spreadGap: number;
  readonly rootFontSize: number;
  readonly lineHeightOverride?: number | undefined;
  readonly lineHeightForce?: boolean | undefined;
  readonly fontFamilyOverride?: string | undefined;
  readonly fontFamilyForce?: boolean | undefined;
}

export interface LayoutConfigInput {
  readonly width: number;
  readonly height: number;
  readonly margin?:
    | number
    | { readonly x: number; readonly y: number }
    | {
        readonly top: number;
        readonly right: number;
        readonly bottom: number;
        readonly left: number;
      };
  readonly spread?: 'single' | 'double';
  readonly firstPageAlone?: boolean;
  readonly spreadGap?: number;
  readonly rootFontSize?: number;
  readonly lineHeightOverride?: number;
  readonly lineHeightForce?: boolean;
  readonly fontFamilyOverride?: string;
  readonly fontFamilyForce?: boolean;
}

/** One spread of the committed layout: the engine's navigation record, page indexes only. */
export interface Spread {
  readonly index: number;
  /** Every page shown on this spread, in reading order. */
  readonly pageIndexes: readonly number[];
  readonly leftPageIndex: number;
  readonly rightPageIndex?: number;
}

export interface ChapterRange {
  readonly startPage: number;
  readonly endPage: number;
}

export type FootnoteKind = 'footnote' | 'endnote' | 'rearnote' | 'note';

export interface FootnoteEntry {
  readonly kind: FootnoteKind;
  readonly text: string;
  readonly html: string;
}

export interface ReaderSourcePoint {
  readonly nodePath: readonly number[];
  /** UTF-16 code-unit offset within the parsed XHTML text node. */
  readonly textOffset: number;
}
export interface ReaderSourceRange {
  readonly start: ReaderSourcePoint;
  /** End-exclusive source boundary. */
  readonly end: ReaderSourcePoint;
}
/**
 * The one persisted annotation format. The engine builds and reads it, so a
 * target stored by any host resolves identically on every other.
 */
export interface ReaderAnnotationTarget {
  readonly version: 1;
  /** Canonical manifest href of the chapter. */
  readonly href: string;
  readonly sourceRange: ReaderSourceRange;
  /** The highlighted text and up to 32 UTF-16 units of context on each side. */
  readonly quote: {
    readonly exact: string;
    readonly prefix: string;
    readonly suffix: string;
  };
  /** UTF-16 offsets into the chapter's canonical text, and its length at creation. */
  readonly position: {
    readonly start: number;
    readonly end: number;
    readonly chapterLength: number;
  };
}
/** Which selector located a stored target; every level but `orphaned` carries it re-anchored. */
export type ReaderAnnotationTargetResolution =
  | {
      readonly level: 'exact' | 'quote' | 'position' | 'progression';
      readonly target: ReaderAnnotationTarget;
    }
  | { readonly level: 'orphaned'; readonly reason: 'hrefNotFound' | 'emptyChapter' };
/** A manifest href and a point in its source tree. */
export interface ReaderSourcePosition {
  readonly href: string;
  readonly point: ReaderSourcePoint;
}
export interface ReaderDocumentSourceSpanEndpoint {
  readonly href: string;
  readonly sourcePoint: ReaderSourcePoint;
}
/** Durable, resource-qualified source identity for both normalized range endpoints. */
export interface ReaderDocumentSourceSpan {
  readonly start: ReaderDocumentSourceSpanEndpoint;
  /** End-exclusive source boundary. */
  readonly end: ReaderDocumentSourceSpanEndpoint;
}
export type ReaderTextSelectionMovement =
  | `character${'Left' | 'Right'}`
  | `word${'Left' | 'Right' | 'StartRight'}`
  | `line${'Up' | 'Down' | 'Start' | 'End'}`
  | `page${'Up' | 'Down'}`
  | `paragraph${'Backward' | 'Forward' | 'PreviousStart' | 'NextStart'}`
  | `${'chapter' | 'document'}${'Start' | 'End'}`;

/** Durable source identity. Page and spread projections are revision-local. */
export interface ReaderLocator {
  readonly href: string;
  readonly anchorId?: string;
  readonly sourcePoint?: ReaderSourcePoint;
  readonly sourceRange?: ReaderSourceRange;
  readonly progression?: number;
}

export type ReaderLocatorMatchedBy =
  | 'sourceRange'
  | 'sourcePoint'
  | 'anchor'
  | 'progression'
  | 'href';

export type ReaderLocatorResolution =
  | {
      readonly status: 'resolved';
      readonly locator: ReaderLocator;
      readonly spineIdref: string;
      readonly pageIndex: number;
      readonly spreadIndex: number;
      readonly matchedBy: ReaderLocatorMatchedBy;
    }
  | {
      readonly status: 'pending';
      readonly locator: ReaderLocator;
      readonly spineIdref: string;
      readonly reason: 'notPaginated' | 'noPageProjection';
      readonly matchedBy: ReaderLocatorMatchedBy;
    };

export type ReaderInteractionTargetKind =
  | 'text'
  | 'link'
  | 'image'
  | 'footnote'
  | 'footnotePending';
/** Paint-order semantic target with bounds in page-content coordinates. */
export interface ReaderInteractionTarget {
  readonly kind: ReaderInteractionTargetKind;
  readonly bounds: Rect;
  readonly label: string;
  readonly href?: string;
  readonly sourceLocator?: ReaderLocator;
  readonly targetLocator?: ReaderLocator;
  readonly destinationLabel?: string;
  readonly imageSrc?: string;
  readonly imageAlt?: string;
  readonly footnoteKey?: string;
}

export interface ReaderPageTargets {
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly targets: readonly ReaderInteractionTarget[];
}

/** Document-order accessibility content with page-local geometry. */
export interface ReaderSemanticNode {
  readonly role:
    | 'heading'
    | 'paragraph'
    | 'list'
    | 'listitem'
    | 'image'
    | 'link'
    | 'blockquote'
    | 'table'
    | 'generic';
  readonly bounds: Rect;
  readonly level?: number | undefined;
  readonly text?: string | undefined;
  readonly alt?: string | undefined;
  readonly href?: string | undefined;
  readonly children: readonly ReaderSemanticNode[];
}

export interface ReaderPageSemantics {
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly nodes: readonly ReaderSemanticNode[];
}

/** Revision-local projection of a durable source locator for a visible page. */
export type ReaderPageReadingAnchor =
  | {
      readonly status: 'resolved';
      readonly pageIndex: number;
      readonly spreadIndex: number;
      /** Persist this locator; page and spread indexes are only a current projection. */
      readonly locator: ReaderLocator;
    }
  | {
      readonly status: 'unavailable';
      readonly pageIndex: number;
      readonly spreadIndex: number;
      readonly reason: 'noSourceContent' | 'sourceUnavailable';
    };

export interface TextPosition {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly charIndex: number;
}

export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

export interface SearchOptions {
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
}

export interface SearchResult {
  readonly pageIndex: number;
  readonly range: TextRange;
  readonly context: string;
  readonly source?: ReaderSearchSourceResolution;
}

export type ReaderSearchSourceResolution =
  | { readonly status: 'resolved'; readonly href: string; readonly sourceRange: ReaderSourceRange }
  | { readonly status: 'unavailable'; readonly reason: 'sourceUnavailable' };
