import type { RitoCoreWasmLayoutConfig } from './common';
import type { RitoFrameCommandBufferMetadata } from './frame';
import type {
  RitoCoreWasmSourceLocator,
  RitoCoreWasmSourceLocatorMatchedBy,
} from './interaction-source';

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

export interface RitoCoreWasmChapterLocalRevisionRequest {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
  readonly targetChapterIndex: number;
  readonly targetLocator: RitoCoreWasmSourceLocator;
}

/**
 * A published chapter-local revision: its identity, the chapter it
 * paginated and the size of that chapter's page table.
 */
export interface RitoCoreWasmChapterLocalRevisionSummary extends RitoCoreWasmChapterLocalOwner {
  readonly layoutKey: string;
  readonly localPageCount: number;
  readonly localSpreadCount: number;
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

/**
 * The result of creating a chapter-local revision: its summary and where
 * the requested locator landed on the chapter's page table.
 */
export interface RitoCoreWasmCreatedChapterLocalRevision {
  readonly revision: RitoCoreWasmChapterLocalRevisionSummary;
  readonly target: RitoCoreWasmChapterLocalSourceLocatorResolution;
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
  Created extends RitoCoreWasmCreatedChapterLocalRevision,
> {
  readonly created: Created;
  /** Present in the same response whenever the target resolved. */
  readonly frame?: RitoCoreWasmReaderChapterLocalFrame | undefined;
}

export interface RitoCoreWasmChapterLocalRevisionRelease {
  readonly owner: RitoCoreWasmChapterLocalOwner;
  readonly releasedRevision: boolean;
  readonly releasedTransferCount: number;
}

export interface RitoCoreWasmReaderChapterLocalClient {
  createChapterLocalRevision(
    request: RitoCoreWasmChapterLocalRevisionRequest,
  ): Promise<RitoCoreWasmReaderChapterLocalMutationResult<RitoCoreWasmCreatedChapterLocalRevision>>;
  releaseChapterLocalRevision(
    owner: RitoCoreWasmChapterLocalOwner,
  ): Promise<RitoCoreWasmChapterLocalRevisionRelease>;
}

export interface RitoCoreWasmChapterLocalDocumentRuntime {
  createChapterLocalRevision(
    request: RitoCoreWasmChapterLocalRevisionRequest,
  ): RitoCoreWasmCreatedChapterLocalRevision;
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
      readonly kind: 'createChapterLocalRevision';
      readonly request: RitoCoreWasmChapterLocalRevisionRequest;
    }
  | {
      readonly kind: 'releaseChapterLocalRevision';
      readonly owner: RitoCoreWasmChapterLocalOwner;
    };

export type RitoCoreWasmReaderChapterLocalWorkerResponse =
  | {
      readonly kind: 'createChapterLocalRevision';
      readonly result: RitoCoreWasmReaderChapterLocalMutationResult<RitoCoreWasmCreatedChapterLocalRevision>;
    }
  | {
      readonly kind: 'releaseChapterLocalRevision';
      readonly result: RitoCoreWasmChapterLocalRevisionRelease;
    };
