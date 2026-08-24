import type { RitoReaderDisplayListV1, RitoReaderRectV1 } from './reader-v1-display';

export type RitoReaderSpreadModeV1 = 'single' | 'double';
export type RitoReaderTextProfileV1 = 'platform-string-runs' | 'positioned-glyph-runs';
export type RitoReaderResourceKindV1 = 'image' | 'font' | 'stylesheet';
export type RitoReaderAdjacentDirectionV1 = 'previous' | 'next';
export type RitoReaderAdjacentAvailabilityV1 =
  | 'available'
  | 'pending'
  | 'chapter-boundary'
  | 'terminal'
  | 'blocked';

export interface RitoReaderSourcePointV1 {
  readonly nodePath: readonly number[];
  readonly textOffset: bigint;
}

export interface RitoReaderSourceRangeV1 {
  readonly start: RitoReaderSourcePointV1;
  readonly end: RitoReaderSourcePointV1;
}

export interface RitoReaderLocatorV1 {
  readonly href: string;
  readonly anchorId?: string | undefined;
  readonly sourcePoint?: RitoReaderSourcePointV1 | undefined;
  readonly sourceRange?: RitoReaderSourceRangeV1 | undefined;
  readonly progression?: number | undefined;
}

export interface RitoReaderPublicationMetadataV1 {
  readonly title: string;
  readonly language: string;
  readonly identifier: string;
  readonly creator?: string | undefined;
}

export interface RitoReaderPublicationSpineItemV1 {
  readonly spineIndex: number;
  readonly linearIndex?: number | undefined;
  readonly idref: string;
  readonly href: string;
}

export type RitoReaderPublicationTocTargetV1 =
  | {
      readonly kind: 'locator';
      readonly spineIndex: number;
      readonly locator: RitoReaderLocatorV1;
    }
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'unresolved'; readonly href: string };

export interface RitoReaderPublicationTocEntryV1 {
  readonly tocId: number;
  readonly label: string;
  readonly target: RitoReaderPublicationTocTargetV1;
  readonly children: readonly RitoReaderPublicationTocEntryV1[];
}

export interface RitoReaderPublicationV1 {
  readonly protocolVersion: 1;
  readonly sessionId: bigint;
  readonly metadata: RitoReaderPublicationMetadataV1;
  readonly spine: readonly RitoReaderPublicationSpineItemV1[];
  readonly toc: readonly RitoReaderPublicationTocEntryV1[];
}

export interface RitoReaderLayoutV1 {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly spreadMode: RitoReaderSpreadModeV1;
  readonly firstPageAlone: boolean;
  readonly spreadGap: number;
  readonly rootFontSize: number;
  readonly lineHeightOverride?: number | undefined;
  readonly fontFamilyOverride?: string | undefined;
}

export interface RitoReaderWorkBudgetV1 {
  readonly maxTopLevelNodesPerQuantum: number;
  readonly maxForegroundQuanta: number;
  readonly localPageCap: number;
}

export interface RitoReaderArtifactRequestInputV1 {
  readonly layout: RitoReaderLayoutV1;
  readonly locator: RitoReaderLocatorV1;
  readonly work: RitoReaderWorkBudgetV1;
  readonly textProfile: RitoReaderTextProfileV1;
}

export interface RitoReaderArtifactRequestV1 extends RitoReaderArtifactRequestInputV1 {
  readonly sessionId: bigint;
  readonly requestId: bigint;
}

export interface RitoReaderAdjacentRequestV1 {
  readonly sessionId: bigint;
  readonly requestId: bigint;
  readonly fromArtifactId: bigint;
  readonly direction: RitoReaderAdjacentDirectionV1;
  readonly work: RitoReaderWorkBudgetV1;
}

export interface RitoReaderForegroundHandoffV1 {
  readonly sessionId: bigint;
  readonly expectedVisibleArtifactId: bigint | undefined;
  readonly candidateArtifactId: bigint;
}

export interface RitoReaderForegroundHandoffAckV1 {
  readonly intentRequestId: bigint;
  readonly replacedArtifactId: bigint | undefined;
  readonly visibleArtifactId: bigint;
}

export interface RitoReaderBackgroundRequestV1 {
  readonly sessionId: bigint;
  readonly expectedVisibleArtifactId: bigint;
  readonly maxTopLevelNodesPerQuantum: number;
}

export type RitoReaderBackgroundStateV1 =
  | 'indexing'
  | 'started'
  | 'advanced'
  | 'reused'
  | 'candidate-pending'
  | 'complete';

export interface RitoReaderBackgroundAdvanceV1 {
  readonly state: RitoReaderBackgroundStateV1;
  readonly intentRequestId: bigint;
  readonly replacesArtifactId: bigint;
  readonly artifact?: RitoReaderArtifactV1 | undefined;
}

export interface RitoReaderBackgroundHandoffV1 {
  readonly sessionId: bigint;
  readonly expectedVisibleArtifactId: bigint;
  readonly candidateArtifactId: bigint;
}

export interface RitoReaderBackgroundHandoffAckV1 {
  readonly intentRequestId: bigint;
  readonly replacedArtifactId: bigint;
  readonly visibleArtifactId: bigint;
}

export interface RitoReaderDisplayListPayloadV1 {
  readonly formatVersion: 1;
  readonly commandCount: number;
  readonly semanticDigest: Uint8Array;
  readonly wireBytes: Uint8Array;
  readonly displayList: RitoReaderDisplayListV1;
}

export interface RitoReaderResourceRefV1 {
  readonly kind: RitoReaderResourceKindV1;
  readonly href: string;
}

export interface RitoReaderFontRefV1 {
  readonly family: string;
  readonly href: string;
  readonly style: string;
  readonly weight: number;
  readonly shapeFingerprint: string;
  readonly byteLength: bigint;
}

export interface RitoReaderHitEntryV1 {
  readonly pageIndex: number;
  readonly bounds: RitoReaderRectV1;
  readonly text: string;
  readonly href?: string | undefined;
  readonly sourcePoint?: RitoReaderSourcePointV1 | undefined;
  readonly imageSrc?: string | undefined;
  readonly imageAlt?: string | undefined;
}

export type RitoReaderSemanticRoleV1 =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'list-item'
  | 'image'
  | 'link'
  | 'blockquote'
  | 'table'
  | 'generic';

export interface RitoReaderSemanticNodeV1 {
  readonly role: RitoReaderSemanticRoleV1;
  readonly level?: number | undefined;
  readonly text?: string | undefined;
  readonly alt?: string | undefined;
  readonly href?: string | undefined;
  readonly bounds: RitoReaderRectV1;
  readonly children: readonly RitoReaderSemanticNodeV1[];
}

export interface RitoReaderTextRunOffsetV1 {
  readonly start: bigint;
  readonly end: bigint;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
}

export interface RitoReaderPageV1 {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly hits: readonly RitoReaderHitEntryV1[];
  readonly semantics: readonly RitoReaderSemanticNodeV1[];
  readonly text: string;
  readonly textLength: bigint;
  readonly textRuns: readonly RitoReaderTextRunOffsetV1[];
}

export interface RitoReaderArtifactV1 {
  readonly protocolVersion: 1;
  readonly capabilityProfileId: 1;
  readonly sessionId: bigint;
  readonly requestId: bigint;
  readonly revisionId: bigint;
  readonly revisionVersion: number;
  readonly artifactId: bigint;
  readonly locator: RitoReaderLocatorV1;
  readonly matchedBy: 'source-range' | 'source-point' | 'anchor' | 'progression' | 'href';
  readonly localPageIndex: number;
  readonly localSpreadIndex: number;
  readonly localPageIndexes: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly terminalExtent: boolean;
  readonly navigation: {
    readonly previous: RitoReaderAdjacentAvailabilityV1;
    readonly next: RitoReaderAdjacentAvailabilityV1;
  };
  readonly textProfile: RitoReaderTextProfileV1;
  readonly displayList: RitoReaderDisplayListPayloadV1;
  readonly resources: readonly RitoReaderResourceRefV1[];
  readonly fonts: readonly RitoReaderFontRefV1[];
  readonly pages: readonly RitoReaderPageV1[];
}

export interface RitoReaderResourceV1 {
  readonly artifactId: bigint;
  readonly kind: RitoReaderResourceKindV1;
  readonly href: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}
