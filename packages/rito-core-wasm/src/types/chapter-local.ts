import type { RitoCoreWasmLayoutConfig, RitoCoreWasmLineBreaking } from './common';
import type { RitoFrameCommandBufferMetadata } from './frame';
import type {
  RitoCoreWasmSourceLocator,
  RitoCoreWasmSourceLocatorMatchedBy,
} from './interaction-source';
import type { RitoCoreWasmRevisionWorkBudget } from './revision';

/** Exact identity for a revision whose page indexes are local to one chapter. */
export interface RitoCoreWasmChapterLocalCoordinate {
  readonly kind: 'chapterLocal';
  readonly chapterIndex: number;
  readonly href: string;
}

export interface RitoCoreWasmChapterLocalOwner {
  readonly revisionId: string;
  readonly revisionVersion: number;
  readonly coordinate: RitoCoreWasmChapterLocalCoordinate;
}

export interface RitoCoreWasmBoundedChapterLocalRevisionRequest {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
  readonly lineBreaking?: RitoCoreWasmLineBreaking | undefined;
  readonly targetChapterIndex: number;
  readonly targetLocator: RitoCoreWasmSourceLocator;
  /** Hard retained-page bound. Rust currently accepts at most 16 local pages. */
  readonly localPageCap: number;
  readonly budget: RitoCoreWasmRevisionWorkBudget;
}

export interface RitoCoreWasmChapterLocalRevisionCursor {
  readonly owner: RitoCoreWasmChapterLocalOwner;
  readonly cursor: string;
  readonly targetLocator: RitoCoreWasmSourceLocator;
}

export interface RitoCoreWasmContinueChapterLocalRevisionRequest {
  readonly continuation: RitoCoreWasmChapterLocalRevisionCursor;
  readonly budget: RitoCoreWasmRevisionWorkBudget;
}

export interface RitoCoreWasmChapterLocalRevisionExtent {
  readonly localPageCount: number;
  readonly localSpreadCount: number;
}

export interface RitoCoreWasmChapterLocalPageRange {
  readonly startLocalPage: number;
  readonly endLocalPageExclusive: number;
}

export interface RitoCoreWasmChapterLocalRevisionSummary extends RitoCoreWasmChapterLocalOwner {
  readonly layoutKey: string;
  readonly status: 'warming' | 'ready' | 'complete';
  readonly localPageCap: number;
  readonly knownExtent: RitoCoreWasmChapterLocalRevisionExtent;
  readonly finalExtent?: RitoCoreWasmChapterLocalRevisionExtent | undefined;
  readonly pageCapReached: boolean;
}

export type RitoCoreWasmChapterLocalSourceLocatorResolution =
  | {
      readonly status: 'resolved';
      readonly owner: RitoCoreWasmChapterLocalOwner;
      readonly locator: RitoCoreWasmSourceLocator;
      readonly spineIdref: string;
      readonly localPageIndex: number;
      readonly localSpreadIndex: number;
      readonly matchedBy: RitoCoreWasmSourceLocatorMatchedBy;
    }
  | {
      readonly status: 'pending';
      readonly owner: RitoCoreWasmChapterLocalOwner;
      readonly locator: RitoCoreWasmSourceLocator;
      readonly spineIdref: string;
      readonly reason: 'notPaginated' | 'noPageProjection';
      readonly matchedBy: RitoCoreWasmSourceLocatorMatchedBy;
    };

/** Raw create advance. It intentionally has no synthetic predecessor-release fields. */
export interface RitoCoreWasmChapterLocalRevisionAdvance {
  readonly revision: RitoCoreWasmChapterLocalRevisionSummary;
  readonly previousKnownExtent: RitoCoreWasmChapterLocalRevisionExtent;
  readonly newlyKnownLocalPages: RitoCoreWasmChapterLocalPageRange;
  readonly processedTopLevelNodes: number;
  readonly target: RitoCoreWasmChapterLocalSourceLocatorResolution;
  readonly continuation?: RitoCoreWasmChapterLocalRevisionCursor | undefined;
}

/** Raw continuation advance with proof that predecessor-local leases were retired. */
export interface RitoCoreWasmContinuedChapterLocalRevisionAdvance extends RitoCoreWasmChapterLocalRevisionAdvance {
  readonly releasedPreviousOwner: RitoCoreWasmChapterLocalOwner;
  readonly releasedPreviousOwnerTransferCount: number;
}

/** Packed-frame metadata that never invents publication-absolute indexes. */
export interface RitoCoreWasmChapterLocalFrameCommandBufferMetadata extends RitoFrameCommandBufferMetadata {
  readonly owner: RitoCoreWasmChapterLocalOwner;
  readonly localSpreadIndex: number;
  readonly width: number;
  readonly height: number;
}

export interface RitoCoreWasmChapterLocalResourcePayload {
  readonly owner: RitoCoreWasmChapterLocalOwner;
  readonly transferId: string;
  readonly kind: 'image';
  readonly href: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface RitoCoreWasmChapterLocalResourceBytes {
  readonly payload: RitoCoreWasmChapterLocalResourcePayload;
  readonly bytes: Uint8Array;
}

export interface RitoCoreWasmChapterLocalMissingResource {
  readonly kind: 'image';
  readonly href: string;
  readonly message: string;
}

export interface RitoCoreWasmReaderChapterLocalFrame {
  readonly owner: RitoCoreWasmChapterLocalOwner;
  readonly localSpreadIndex: number;
  readonly metadata: RitoCoreWasmChapterLocalFrameCommandBufferMetadata;
  readonly bytes: Uint8Array;
  readonly resources: readonly RitoCoreWasmChapterLocalResourceBytes[];
  readonly missingResources: readonly RitoCoreWasmChapterLocalMissingResource[];
}

export interface RitoCoreWasmReaderChapterLocalMutationResult<
  Advance extends RitoCoreWasmChapterLocalRevisionAdvance,
> {
  readonly advance: Advance;
  /** Present in the same response whenever the target resolved in this quantum. */
  readonly frame?: RitoCoreWasmReaderChapterLocalFrame | undefined;
}

export interface RitoCoreWasmChapterLocalRevisionRelease {
  readonly owner: RitoCoreWasmChapterLocalOwner;
  readonly releasedRevision: boolean;
  readonly releasedTransferCount: number;
}

export interface RitoCoreWasmReaderChapterLocalClient {
  createBoundedChapterLocalRevision(
    request: RitoCoreWasmBoundedChapterLocalRevisionRequest,
  ): Promise<RitoCoreWasmReaderChapterLocalMutationResult<RitoCoreWasmChapterLocalRevisionAdvance>>;
  continueChapterLocalRevision(
    request: RitoCoreWasmContinueChapterLocalRevisionRequest,
  ): Promise<
    RitoCoreWasmReaderChapterLocalMutationResult<RitoCoreWasmContinuedChapterLocalRevisionAdvance>
  >;
  releaseChapterLocalRevision(
    owner: RitoCoreWasmChapterLocalOwner,
  ): Promise<RitoCoreWasmChapterLocalRevisionRelease>;
}

export interface RitoCoreWasmChapterLocalDocumentRuntime {
  createBoundedChapterLocalRevision(
    request: RitoCoreWasmBoundedChapterLocalRevisionRequest,
  ): RitoCoreWasmChapterLocalRevisionAdvance;
  continueChapterLocalRevision(
    request: RitoCoreWasmContinueChapterLocalRevisionRequest,
  ): RitoCoreWasmContinuedChapterLocalRevisionAdvance;
  readChapterLocalFrame(
    owner: RitoCoreWasmChapterLocalOwner,
    localSpreadIndex: number,
  ): Omit<RitoCoreWasmReaderChapterLocalFrame, 'resources' | 'missingResources'>;
  prefetchChapterLocalFrameResources(
    owner: RitoCoreWasmChapterLocalOwner,
    localSpreadIndex: number,
  ): Pick<
    RitoCoreWasmReaderChapterLocalFrame,
    'owner' | 'localSpreadIndex' | 'resources' | 'missingResources'
  >;
  releaseChapterLocalRevision(
    owner: RitoCoreWasmChapterLocalOwner,
  ): RitoCoreWasmChapterLocalRevisionRelease;
}

export type RitoCoreWasmReaderChapterLocalWorkerRequestPayload =
  | {
      readonly kind: 'createBoundedChapterLocalRevision';
      readonly request: RitoCoreWasmBoundedChapterLocalRevisionRequest;
    }
  | {
      readonly kind: 'continueChapterLocalRevision';
      readonly request: RitoCoreWasmContinueChapterLocalRevisionRequest;
    }
  | {
      readonly kind: 'releaseChapterLocalRevision';
      readonly owner: RitoCoreWasmChapterLocalOwner;
    };

export type RitoCoreWasmReaderChapterLocalWorkerResponse =
  | {
      readonly kind: 'createBoundedChapterLocalRevision';
      readonly result: RitoCoreWasmReaderChapterLocalMutationResult<RitoCoreWasmChapterLocalRevisionAdvance>;
    }
  | {
      readonly kind: 'continueChapterLocalRevision';
      readonly result: RitoCoreWasmReaderChapterLocalMutationResult<RitoCoreWasmContinuedChapterLocalRevisionAdvance>;
    }
  | {
      readonly kind: 'releaseChapterLocalRevision';
      readonly result: RitoCoreWasmChapterLocalRevisionRelease;
    };
