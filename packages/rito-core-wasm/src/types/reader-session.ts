import type { RitoReaderRect } from './reader-session-display';
import type { RitoReaderPrimitiveList } from './reader-session-primitive';

export type RitoReaderSpreadMode = 'single' | 'double';
export type RitoReaderTextProfile = 'platform-string-runs' | 'positioned-glyph-runs';
export type RitoReaderResourceKind = 'image' | 'font' | 'stylesheet';
export type RitoReaderAdjacentDirection = 'previous' | 'next';
export type RitoReaderAdjacentAvailability = 'available' | 'chapter-boundary' | 'terminal';

export interface RitoReaderSourcePoint {
  readonly nodePath: readonly number[];
  readonly textOffset: bigint;
}

export interface RitoReaderSourceRange {
  readonly start: RitoReaderSourcePoint;
  readonly end: RitoReaderSourcePoint;
}

export interface RitoReaderLocator {
  readonly href: string;
  readonly anchorId?: string | undefined;
  readonly sourcePoint?: RitoReaderSourcePoint | undefined;
  readonly sourceRange?: RitoReaderSourceRange | undefined;
  readonly progression?: number | undefined;
}

export interface RitoReaderPublicationMetadata {
  readonly title: string;
  readonly language: string;
  readonly identifier: string;
  readonly creator?: string | undefined;
}

export interface RitoReaderPublicationSpineItem {
  readonly spineIndex: number;
  readonly linearIndex?: number | undefined;
  readonly idref: string;
  readonly href: string;
}

export type RitoReaderPublicationTocTarget =
  | {
      readonly kind: 'locator';
      readonly spineIndex: number;
      readonly locator: RitoReaderLocator;
    }
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'unresolved'; readonly href: string };

export interface RitoReaderPublicationTocEntry {
  readonly tocId: number;
  readonly label: string;
  readonly target: RitoReaderPublicationTocTarget;
  readonly children: readonly RitoReaderPublicationTocEntry[];
}

export interface RitoReaderPublication {
  readonly protocolVersion: 1;
  readonly sessionId: bigint;
  readonly metadata: RitoReaderPublicationMetadata;
  readonly spine: readonly RitoReaderPublicationSpineItem[];
  readonly toc: readonly RitoReaderPublicationTocEntry[];
}

export interface RitoReaderLayout {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly spreadMode: RitoReaderSpreadMode;
  readonly firstPageAlone: boolean;
  readonly spreadGap: number;
  readonly rootFontSize: number;
  /** Device pixels per CSS pixel the artifact is rasterized at; paint snaps land on that grid. Default 1. */
  readonly renderRatio?: number | undefined;
  readonly lineHeightOverride?: number | undefined;
  readonly fontFamilyOverride?: string | undefined;
  /**
   * Whether the line-height override outranks the publication's own
   * declarations. Unforced, a rule the book wrote for an element keeps its
   * value and only text that inherits takes the reader's. Default true.
   */
  readonly lineHeightForce?: boolean | undefined;
  /** The same choice for the font-family override. Default true. */
  readonly fontFamilyForce?: boolean | undefined;
}

export interface RitoReaderArtifactRequestInput {
  readonly layout: RitoReaderLayout;
  readonly locator: RitoReaderLocator;
  readonly textProfile: RitoReaderTextProfile;
}

export interface RitoReaderArtifactRequest extends RitoReaderArtifactRequestInput {
  readonly sessionId: bigint;
  readonly requestId: bigint;
}

export interface RitoReaderAdjacentRequest {
  readonly sessionId: bigint;
  readonly requestId: bigint;
  readonly fromArtifactId: bigint;
  readonly direction: RitoReaderAdjacentDirection;
}

/** `RITOSPQ1`: one spread of the revision behind an artifact, by its position in the layout. */
export interface RitoReaderSpreadRequest {
  readonly sessionId: bigint;
  readonly requestId: bigint;
  readonly fromArtifactId: bigint;
  readonly spreadIndex: number;
}

export interface RitoReaderForegroundHandoff {
  readonly sessionId: bigint;
  readonly expectedVisibleArtifactId: bigint | undefined;
  readonly candidateArtifactId: bigint;
}

export interface RitoReaderForegroundHandoffAck {
  readonly intentRequestId: bigint;
  readonly replacedArtifactId: bigint | undefined;
  readonly visibleArtifactId: bigint;
}

export interface RitoReaderBackgroundRequest {
  readonly sessionId: bigint;
  readonly expectedVisibleArtifactId: bigint;
  readonly maxPagesPerQuantum: number;
}

export type RitoReaderBackgroundState =
  | 'indexing'
  | 'started'
  | 'advanced'
  | 'reused'
  | 'candidate-pending'
  | 'complete';

export interface RitoReaderBackgroundAdvance {
  readonly state: RitoReaderBackgroundState;
  readonly intentRequestId: bigint;
  readonly replacesArtifactId: bigint;
  /** Whether adopting `artifact` changes what the reader sees, rather than renumbering it. */
  readonly movesVisibleContent: boolean;
  readonly artifact?: RitoReaderArtifact | undefined;
}

export interface RitoReaderBackgroundHandoff {
  readonly sessionId: bigint;
  readonly expectedVisibleArtifactId: bigint;
  readonly candidateArtifactId: bigint;
}

export interface RitoReaderBackgroundHandoffAck {
  readonly intentRequestId: bigint;
  readonly replacedArtifactId: bigint;
  readonly visibleArtifactId: bigint;
}

/** The artifact's paint: its display commands lowered to the host's
 * device grid, carried as the `RITODL1` format-3 primitive list. */
export interface RitoReaderDisplayListPayload {
  readonly formatVersion: 3;
  readonly commandCount: number;
  readonly wireBytes: Uint8Array;
  readonly displayList: RitoReaderPrimitiveList;
}

export interface RitoReaderResourceRef {
  readonly kind: RitoReaderResourceKind;
  readonly href: string;
}

export interface RitoReaderFontRef {
  readonly family: string;
  readonly href: string;
  readonly style: string;
  readonly weight: number;
  readonly shapeFingerprint: string;
  readonly byteLength: bigint;
}

/**
 * What a hit is, as the engine classifies it: a note reference first (its
 * definition indexed, or not yet), then a link, an image, text.
 */
export type RitoReaderHitKind = 'text' | 'link' | 'image' | 'footnote' | 'footnote-pending';

export interface RitoReaderHitEntry {
  readonly pageIndex: number;
  /** In the artifact's display-list space: page offset and margins included. */
  readonly bounds: RitoReaderRect;
  readonly kind: RitoReaderHitKind;
  readonly text: string;
  /** The href as the publication wrote it. */
  readonly href?: string | undefined;
  readonly sourcePoint?: RitoReaderSourcePoint | undefined;
  /** Where an internal link leads, canonical; absent for an external href. */
  readonly targetLocator?: RitoReaderLocator | undefined;
  /** The TOC label of the place a link leads to, when the TOC names it. */
  readonly destinationLabel?: string | undefined;
  readonly imageSrc?: string | undefined;
  readonly imageAlt?: string | undefined;
  /** The key a note reference's definition is read by, verbatim. */
  readonly footnoteKey?: string | undefined;
}

export type RitoReaderSemanticRole =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'list-item'
  | 'image'
  | 'link'
  | 'blockquote'
  | 'table'
  | 'generic';

export interface RitoReaderSemanticNode {
  readonly role: RitoReaderSemanticRole;
  readonly level?: number | undefined;
  readonly text?: string | undefined;
  readonly alt?: string | undefined;
  readonly href?: string | undefined;
  readonly bounds: RitoReaderRect;
  readonly children: readonly RitoReaderSemanticNode[];
}

export interface RitoReaderTextRunOffset {
  readonly start: bigint;
  readonly end: bigint;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
}

export interface RitoReaderPage {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly hits: readonly RitoReaderHitEntry[];
  readonly semantics: readonly RitoReaderSemanticNode[];
  readonly text: string;
  readonly textLength: bigint;
  readonly textRuns: readonly RitoReaderTextRunOffset[];
}

export interface RitoReaderArtifact {
  readonly protocolVersion: 1;
  readonly capabilityProfileId: 1;
  readonly sessionId: bigint;
  readonly requestId: bigint;
  readonly revisionId: bigint;
  readonly revisionVersion: number;
  readonly artifactId: bigint;
  readonly locator: RitoReaderLocator;
  readonly matchedBy: 'source-range' | 'source-point' | 'anchor' | 'progression' | 'href';
  readonly localPageIndex: number;
  readonly localSpreadIndex: number;
  readonly localPageIndexes: readonly number[];
  readonly width: number;
  readonly height: number;
  /**
   * Zero-based page number within the whole book, present only on an
   * artifact published from the whole-book layout. A chapter laid out alone
   * has no book-wide numbering, so the field is absent rather than zero.
   */
  readonly bookPageIndex?: number | undefined;
  /** The whole book's page count, present together with `bookPageIndex`. */
  readonly bookPageCount?: number | undefined;
  readonly navigation: {
    readonly previous: RitoReaderAdjacentAvailability;
    readonly next: RitoReaderAdjacentAvailability;
  };
  readonly textProfile: RitoReaderTextProfile;
  readonly displayList: RitoReaderDisplayListPayload;
  readonly resources: readonly RitoReaderResourceRef[];
  readonly fonts: readonly RitoReaderFontRef[];
  readonly pages: readonly RitoReaderPage[];
}

export interface RitoReaderResource {
  readonly artifactId: bigint;
  readonly kind: RitoReaderResourceKind;
  readonly href: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}
