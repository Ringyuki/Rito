import type { RitoCoreWasmJsonObject, RitoCoreWasmResourceKind } from './common';
import type { RitoCoreWasmFrameCommandBufferMetadata } from './frame';
import type { RitoCoreWasmChapterTextIndices } from './interaction';
import type { RitoCoreWasmPublicationInfo, RitoCoreWasmTocEntry } from './publication';
import type { RitoCoreWasmFrameResourceWarmPlan, RitoCoreWasmResourcePayload } from './resource';
import type { RitoCoreWasmSearchRequest, RitoCoreWasmSearchResponse } from './search';
import type { RitoCoreWasmReaderRuntimeWire } from './runtime-bundle';
import type {
  RitoCoreWasmRevisionBundle,
  RitoCoreWasmRevisionFrameSelection,
  RitoCoreWasmViewRevisionFollowUp,
  RitoCoreWasmViewRevisionRequest,
  RitoCoreWasmViewRevisionResponse,
} from './revision';

export interface RitoCoreWasmReaderWorkerClient {
  /** Stable identity for this client's sole worker or in-process publication session. */
  readonly sessionId: string;
  /** Opens this client's sole publication session. Failed opens may be retried. */
  open(data: ArrayBuffer): Promise<RitoCoreWasmReaderOpenResult>;
  createViewRevision(
    request: RitoCoreWasmViewRevisionRequest,
  ): Promise<RitoCoreWasmReaderViewRevisionResult>;
  readResource(
    revisionId: string,
    kind: RitoCoreWasmResourceKind,
    href: string,
  ): Promise<RitoCoreWasmReaderResourceBytes>;
  warmFrameWindow(
    revisionId: string,
    spreadIndex: number,
  ): Promise<RitoCoreWasmReaderFrameWindowWarmResult>;
  resolveLocator(
    revisionId: string,
    locator: RitoCoreWasmJsonObject,
  ): Promise<RitoCoreWasmReaderTocTarget>;
  search(
    revisionId: string,
    request: RitoCoreWasmSearchRequest,
  ): Promise<RitoCoreWasmSearchResponse>;
  releaseRevisionTransfers(revisionId: string): Promise<void>;
  releaseRevision(revisionId: string): Promise<void>;
  dispose(): void;
}

/** Opaque cache shared by reader clients for one publication session. */
export interface RitoCoreWasmReaderSessionCache {
  readonly __ritoCoreWasmReaderSessionCache?: true;
}

export type RitoCoreWasmReaderChapterTextIndicesTransport =
  | RitoCoreWasmChapterTextIndices
  | {
      readonly revisionId: string;
      readonly entries?: RitoCoreWasmChapterTextIndices['entries'] | undefined;
      readonly scopeKey: 'chapter-text-v1:full';
    };

export type RitoCoreWasmReaderRevisionBundleTransport = Omit<
  RitoCoreWasmRevisionBundle,
  'chapterTextIndices'
> & {
  readonly chapterTextIndices: RitoCoreWasmReaderChapterTextIndicesTransport;
};

export type RitoCoreWasmReaderRevisionResultTransport = Omit<
  RitoCoreWasmReaderRevisionResult,
  'bundle'
> & {
  readonly bundle: RitoCoreWasmReaderRevisionBundleTransport;
};

export type RitoCoreWasmReaderViewRevisionResultTransport = Omit<
  RitoCoreWasmReaderViewRevisionResult,
  'result'
> & {
  readonly result: RitoCoreWasmReaderRevisionResultTransport;
};

export interface RitoCoreWasmReaderWorkerErrorPayload {
  readonly name: string;
  readonly message: string;
  readonly code?: string | undefined;
}

export type RitoCoreWasmReaderWorkerResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly payload: RitoCoreWasmReaderWorkerResponsePayload;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: RitoCoreWasmReaderWorkerErrorPayload;
    };

export interface RitoCoreWasmReaderWorkerScope {
  postMessage(message: RitoCoreWasmReaderWorkerResponse, transfer?: readonly Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
}

export interface RitoCoreWasmReaderWorkerHandlerDeps {
  readonly initRitoCoreWasmEngine: () => Promise<RitoCoreWasmReaderEngineRuntime>;
  readonly normalizeRitoCoreWasmError: (
    error: unknown,
    operation?: string,
  ) => Error & { readonly code?: string | undefined };
}

export interface RitoCoreWasmReaderWorkerLike {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'error', listener: (event: { readonly message?: string }) => void): void;
  addEventListener(type: 'messageerror', listener: () => void): void;
  postMessage(message: RitoCoreWasmReaderWorkerRequest, transfer?: readonly Transferable[]): void;
  terminate(): void;
}

export interface RitoCoreWasmReaderDocumentRuntime {
  free(): void;
  publication(): RitoCoreWasmPublicationInfo;
  createViewRevisionBundle(
    request: RitoCoreWasmViewRevisionRequest,
  ): RitoCoreWasmViewRevisionResponse;
  createViewRevisionBundleBytes(
    request: RitoCoreWasmViewRevisionRequest,
  ): RitoCoreWasmViewRevisionResponse;
  readerWorkerPayload(
    request: RitoCoreWasmReaderWorkerRequest,
  ): RitoCoreWasmReaderWorkerResponsePayload;
}

export interface RitoCoreWasmReaderEngineRuntime {
  openDocument(bytes: Uint8Array): RitoCoreWasmReaderDocumentRuntime;
}

export interface RitoCoreWasmReaderBindingRuntimeModule {
  initRitoCoreWasmEngine?: (() => Promise<RitoCoreWasmReaderEngineRuntime>) | undefined;
}

export interface RitoCoreWasmReaderRevisionResult {
  readonly bundle: RitoCoreWasmRevisionBundle;
  readonly frameSelection?: RitoCoreWasmRevisionFrameSelection | undefined;
  readonly selectedFrame?: RitoCoreWasmReaderSelectedFrame | undefined;
  readonly frameWindow?: RitoCoreWasmReaderFrameWindowWarmResult | undefined;
  readonly preview: boolean;
}

export interface RitoCoreWasmReaderViewRevisionResult {
  readonly kind: RitoCoreWasmViewRevisionResponse['kind'];
  readonly display: RitoCoreWasmViewRevisionResponse['display'];
  readonly followUp?: RitoCoreWasmViewRevisionFollowUp | undefined;
  readonly result: RitoCoreWasmReaderRevisionResult;
}

export type RitoCoreWasmReaderOpenResult = { readonly publication: RitoCoreWasmPublicationInfo };

export interface RitoCoreWasmReaderFrameBuffer {
  readonly metadata: RitoCoreWasmFrameCommandBufferMetadata;
  readonly bytes: Uint8Array;
}

export interface RitoCoreWasmReaderSelectedFrame {
  readonly spreadIndex: number;
  readonly displaySpreadIndex: number;
  readonly frame: RitoCoreWasmReaderFrameBuffer;
}

export interface RitoCoreWasmReaderResourceBytes {
  readonly payload: RitoCoreWasmResourcePayload;
  readonly bytes: Uint8Array;
}

export interface RitoCoreWasmReaderFrameWindowWarmResult {
  readonly plan: RitoCoreWasmFrameResourceWarmPlan;
  readonly frames: readonly RitoCoreWasmReaderFrameBuffer[];
  readonly spreads: readonly {
    readonly spreadIndex: number;
    readonly resources: readonly RitoCoreWasmReaderResourceBytes[];
  }[];
}

export interface RitoCoreWasmReaderTocTarget {
  readonly entry: RitoCoreWasmTocEntry;
  readonly pageIndex: number;
  readonly spreadIndex: number;
}

type WorkerRequestId = { readonly id: number };

export type RitoCoreWasmReaderWorkerRequest = WorkerRequestId &
  (
    | { readonly kind: 'open'; readonly data: ArrayBuffer }
    | {
        readonly kind: 'createViewRevision';
        readonly request: RitoCoreWasmViewRevisionRequest;
        readonly wire?: RitoCoreWasmReaderRuntimeWire | undefined;
        readonly knownFullChapterTextIndicesScopeKey?: 'chapter-text-v1:full' | undefined;
      }
    | {
        readonly kind: 'readResource';
        readonly revisionId: string;
        readonly resourceKind: RitoCoreWasmResourceKind;
        readonly href: string;
      }
    | {
        readonly kind: 'warmFrameWindow';
        readonly revisionId: string;
        readonly spreadIndex: number;
      }
    | {
        readonly kind: 'resolveLocator';
        readonly revisionId: string;
        readonly locator: RitoCoreWasmJsonObject;
      }
    | {
        readonly kind: 'search';
        readonly revisionId: string;
        readonly request: RitoCoreWasmSearchRequest;
      }
    | { readonly kind: 'releaseRevisionTransfers'; readonly revisionId: string }
    | { readonly kind: 'releaseRevision'; readonly revisionId: string }
    | { readonly kind: 'dispose' }
  );

export type RitoCoreWasmReaderWorkerResponsePayload =
  | { readonly kind: 'open'; readonly result: RitoCoreWasmReaderOpenResult }
  | {
      readonly kind: 'createViewRevision';
      readonly result: RitoCoreWasmReaderViewRevisionResultTransport;
    }
  | { readonly kind: 'readResource'; readonly result: RitoCoreWasmReaderResourceBytes }
  | { readonly kind: 'warmFrameWindow'; readonly result: RitoCoreWasmReaderFrameWindowWarmResult }
  | { readonly kind: 'resolveLocator'; readonly result: RitoCoreWasmReaderTocTarget }
  | { readonly kind: 'search'; readonly result: RitoCoreWasmSearchResponse }
  | { readonly kind: 'releaseRevisionTransfers' }
  | { readonly kind: 'releaseRevision' }
  | { readonly kind: 'dispose' };
