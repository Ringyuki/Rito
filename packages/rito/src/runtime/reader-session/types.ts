import type { Rect } from '../../layout/core/types';
import type { DisplayList } from '../../render/display-list/types';
import type { FootnoteEntry } from '../footnote-extractor';

export type ReaderRuntimeRequestId = string;
export type ReaderSessionId = string;
export type ReaderRevisionId = string;
export type ReaderLayoutKey = string;
export type ReaderResourceId = string;

export interface ReaderPublication {
  readonly metadata: {
    readonly title: string;
    readonly language: string;
    readonly identifier: string;
    readonly creator?: string;
  };
  readonly spineItemCount: number;
}

export interface ReaderViewport {
  readonly width: number;
  readonly height: number;
}

export interface ReaderLayoutRequest {
  readonly viewport: ReaderViewport;
  readonly spreadMode: 'single' | 'double';
  readonly margin: number;
  readonly lineBreaking?: 'greedy' | 'optimal';
  readonly typography?: {
    readonly fontSize?: number;
    readonly lineHeight?: number;
    readonly lineHeightForce?: boolean;
    readonly fontFamily?: string;
    readonly fontFamilyForce?: boolean;
  };
}

export type ReaderRevisionStatus = 'warming' | 'ready' | 'complete' | 'cancelled' | 'failed';

export interface ReaderRevision {
  readonly id: ReaderRevisionId;
  readonly sessionId: ReaderSessionId;
  readonly layoutKey: ReaderLayoutKey;
  readonly status: ReaderRevisionStatus;
  readonly knownSpreadCount: number;
  readonly finalSpreadCount?: number;
  readonly createdAt: number;
}

export interface ReaderLocator {
  readonly href: string;
  readonly mediaType: string;
  readonly progression: number;
  readonly totalProgression?: number;
  readonly position?: number;
  readonly anchorId?: string;
  readonly text?: {
    readonly before?: string;
    readonly highlight?: string;
    readonly after?: string;
  };
  readonly sourceRange?: {
    readonly start: number;
    readonly end: number;
  };
}

export interface ResolvedLocator {
  readonly locator: ReaderLocator;
  readonly revisionId: ReaderRevisionId;
  readonly spreadIndex: number;
  readonly pageIndex: number;
}

export interface ReaderLocatorGeometrySegment {
  readonly spreadIndex: number;
  readonly pageIndex: number;
  readonly rects: readonly Rect[];
}

export interface ResolvedLocatorGeometry {
  readonly locator: ReaderLocator;
  readonly revisionId: ReaderRevisionId;
  readonly segments: readonly ReaderLocatorGeometrySegment[];
}

export type ReaderResourceKind = 'font' | 'image' | 'stylesheet' | 'publication';

export interface ReaderResourceRef {
  readonly id: ReaderResourceId;
  readonly kind: ReaderResourceKind;
  readonly href: string;
  readonly mediaType?: string;
  readonly hash?: string;
}

export interface ReaderFootnoteRef {
  readonly href: string;
}

export interface ReaderTextRunTarget {
  readonly rect: Rect;
  readonly text: string;
  readonly locator: ReaderLocator;
  readonly sourceTextOffset?: number;
}

export interface ReaderInteractionTarget {
  readonly kind: 'link' | 'image' | 'footnote' | 'text';
  readonly rect: Rect;
  readonly locator: ReaderLocator;
  readonly href?: string;
  readonly footnoteRef?: ReaderFootnoteRef;
  readonly resourceRef?: ReaderResourceRef;
  readonly label: string;
}

export interface ReaderSpreadFrame {
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly spreadIndex: number;
  readonly pageIndexes: readonly number[];
  readonly viewport: ReaderViewport;
  readonly displayList: DisplayList;
  readonly textRuns: readonly ReaderTextRunTarget[];
  readonly targets: readonly ReaderInteractionTarget[];
  readonly resourceRefs: readonly ReaderResourceRef[];
  readonly primaryLocator: ReaderLocator;
}

export interface ResolveLocatorRequest {
  readonly locator: ReaderLocator;
}

export interface ResolveLocatorGeometryRequest {
  readonly locator: ReaderLocator;
}

export interface SpreadFrameRequest {
  readonly spreadIndex: number;
}

export interface PrefetchRequest {
  readonly spreadIndexes: readonly number[];
}

export interface SearchRequest {
  readonly query: string;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly limit?: number;
}

export interface ReaderSearchResult {
  readonly locator: ReaderLocator;
  readonly snippet: string;
  readonly rects?: readonly Rect[];
}

export interface SearchBatch {
  readonly results: readonly ReaderSearchResult[];
  readonly hasMore: boolean;
}

export interface FootnoteRequest {
  readonly ref: ReaderFootnoteRef;
}

export interface ReaderFootnotePayload {
  readonly ref: ReaderFootnoteRef;
  readonly footnote: FootnoteEntry;
}

export interface ResourceRequest {
  readonly resource: ReaderResourceRef;
}

export interface ReaderResourcePayload {
  readonly resource: ReaderResourceRef;
  readonly byteLength: number;
  readonly transferId: string;
  readonly mediaType?: string;
}
