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
  readonly maxTopLevelNodesPerQuantum: number;
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
 * device grid, carried as the `RITODL1` format-2 primitive list. */
export interface RitoReaderDisplayListPayload {
  readonly formatVersion: 2;
  readonly commandCount: number;
  readonly semanticDigest: Uint8Array;
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

export interface RitoReaderHitEntry {
  readonly pageIndex: number;
  readonly bounds: RitoReaderRect;
  readonly text: string;
  readonly href?: string | undefined;
  readonly sourcePoint?: RitoReaderSourcePoint | undefined;
  readonly imageSrc?: string | undefined;
  readonly imageAlt?: string | undefined;
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
