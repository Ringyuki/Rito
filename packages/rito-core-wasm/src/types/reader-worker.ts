import type { RitoCoreWasmJsonObject, RitoCoreWasmResourceKind } from './common';
import type {
  RitoCoreWasmChapterLocalDocumentRuntime,
  RitoCoreWasmReaderChapterLocalClient,
  RitoCoreWasmReaderChapterLocalWorkerRequestPayload,
  RitoCoreWasmReaderChapterLocalWorkerResponse,
} from './chapter-local';
import type { RitoCoreWasmFrameCommandBufferMetadata } from './frame';
import type { RitoCoreWasmPublicationInfo, RitoCoreWasmTocEntry } from './publication';
import type {
  RitoCoreWasmFontCatalog,
  RitoCoreWasmHostFontFaceInput,
  RitoCoreWasmOpenDocumentOptions,
  RitoCoreWasmPinnedFontFaceInput,
  RitoCoreWasmPinnedFontGenericRole,
  RitoCoreWasmPinnedFontPolicySummary,
} from './pinned-font';
import type {
  RitoCoreWasmFrameResourceWarmPlan,
  RitoCoreWasmMissingResource,
  RitoCoreWasmPendingResource,
  RitoCoreWasmResourcePayload,
} from './resource';
import type { RitoCoreWasmSearchRequest, RitoCoreWasmSearchResponse } from './search';
import type {
  RitoCoreWasmReaderVersionedClient,
  RitoCoreWasmReaderVersionedDocumentRuntime,
  RitoCoreWasmReaderVersionedErrorMetadata,
  RitoCoreWasmReaderVersionedWorkerHandlerDeps,
  RitoCoreWasmReaderVersionedWorkerRequestPayload,
  RitoCoreWasmReaderVersionedWorkerResponse,
} from './reader-worker-versioned';
import type { RitoCoreWasmRevisionBundle, RitoCoreWasmRevisionFrameSelection } from './revision';

export interface RitoCoreWasmReaderWorkerClient
  extends RitoCoreWasmReaderVersionedClient, RitoCoreWasmReaderChapterLocalClient {
  /** Stable identity for this client's sole worker or in-process publication session. */
  readonly sessionId: string;
  /**
   * Opens this client's sole publication session. A real Worker takes ownership
   * of `data` and every pinned face buffer after validation; failed validation
   * leaves them attached. Failed engine opens may be retried with fresh buffers.
   */
  open(
    data: ArrayBuffer | RitoCoreWasmShardedPublication,
    options?: RitoCoreWasmReaderWorkerOpenOptions,
  ): Promise<RitoCoreWasmReaderOpenResult>;
  readResource(
    revisionId: string,
    kind: RitoCoreWasmResourceKind,
    href: string,
  ): Promise<RitoCoreWasmReaderResourceBytes>;
  warmFrameWindow(
    revisionId: string,
    spreadIndex: number,
  ): Promise<RitoCoreWasmReaderFrameWindowWarmResult>;
  /**
   * Supplies a sharded publication's image shards ahead of need, those
   * nearest the chapter at `href` first, one at a time and only while no
   * other call is in flight. Calling it again with another chapter
   * reorders what is left; a no-op for a publication opened from an
   * archive.
   */
  prefetchShardsNear(href: string): Promise<void>;
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
  /**
   * Records publication faces the host's font decoder rejected. The
   * browser cannot paint these faces, so the engine stops shaping with
   * them; an engine that already shaped with one rebuilds on the next
   * layout, and the caller forces a reflow so committed pages follow.
   */
  setUnavailableFontFaces(families: readonly string[]): Promise<void>;
  /** Every family a `font-family` list can name in the open document. */
  fontCatalog(): Promise<RitoCoreWasmFontCatalog>;
  /** The names in a CSS `font-family` list no family answers to. */
  unresolvedFontFamilies(familyList: string): Promise<readonly string[]>;
  /**
   * Adds host faces after the document's and returns the extended policy
   * summary. The face buffers are transferred: pass buffers the caller can
   * lose. Every layout key changes, so the next layout uses the faces.
   */
  addHostFontFaces(
    faces: readonly RitoCoreWasmHostFontFaceInput[],
  ): Promise<RitoCoreWasmPinnedFontPolicySummary>;
  /** Removes host faces by SHA-256 and returns the remaining policy summary. */
  removeHostFontFaces(sha256s: readonly string[]): Promise<RitoCoreWasmPinnedFontPolicySummary>;
  /** Device pixels per CSS pixel frames are painted at (zoom × dpr); paint snaps land on that grid. */
  setRenderRatio(ratio: number): Promise<void>;
  /**
   * Diagnostic: one chapter's page-by-page ink-less lines through the
   * revision's own fragment engine and content box, for diffing the wasm
   * pipeline against the native chapter-fragment-probe example.
   */
  chapterFragmentProbe(revisionId: string, idref: string): Promise<RitoCoreWasmJsonObject>;
  dispose(): void;
  /** Resolves after in-process release or Worker acknowledgement/forced termination. */
  whenDisposed(): Promise<void>;
}

/**
 * A publication split by `rito-pack`: the reader opens from the skeleton and
 * asks `loadShards` for each content shard the first time a call needs it.
 */
export interface RitoCoreWasmShardedPublication {
  readonly skeleton: ArrayBuffer;
  /** The skeleton's 32-byte key when the shards are encrypted. */
  readonly key?: Uint8Array | undefined;
  /**
   * Resolves with the requested shards. Rejecting fails the call that needed
   * them; the reader stays usable for everything else.
   */
  loadShards(shardIds: readonly number[]): Promise<readonly RitoCoreWasmPublicationShard[]>;
}

export interface RitoCoreWasmPublicationShard {
  readonly id: number;
  readonly bytes: ArrayBuffer | Uint8Array;
  /** The shard's own 32-byte key when the shards are encrypted. */
  readonly key?: Uint8Array | undefined;
}

/** Opaque cache shared by reader clients for one publication session. */
export interface RitoCoreWasmReaderSessionCache {
  readonly __ritoCoreWasmReaderSessionCache?: true;
}

export interface RitoCoreWasmReaderWorkerErrorPayload extends RitoCoreWasmReaderVersionedErrorMetadata {
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

export interface RitoCoreWasmReaderWorkerHandlerDeps extends RitoCoreWasmReaderVersionedWorkerHandlerDeps {
  readonly initRitoCoreWasmEngine: () => Promise<RitoCoreWasmReaderEngineRuntime>;
  /**
   * Optional WASM linear-memory high-water accessor; when present, dispose
   * acknowledgements carry the current byteLength so the client's recycle
   * policy can bound how large a reused instance may grow.
   */
  readonly ritoCoreWasmMemoryByteLength?: (() => number) | undefined;
}

export interface RitoCoreWasmReaderWorkerLike {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'error', listener: (event: { readonly message?: string }) => void): void;
  addEventListener(type: 'messageerror', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(
    type: 'error',
    listener: (event: { readonly message?: string }) => void,
  ): void;
  removeEventListener(type: 'messageerror', listener: () => void): void;
  postMessage(message: RitoCoreWasmReaderWorkerRequest, transfer?: readonly Transferable[]): void;
  terminate(): void;
}

export interface RitoCoreWasmWorkerReaderClientOptions {
  /**
   * Accepts ownership after a valid acknowledgement released a document and
   * all listeners belonging to the logical client have been detached.
   */
  readonly recycleWorker?: ((worker: RitoCoreWasmReaderWorkerLike) => boolean) | undefined;
}

export interface RitoCoreWasmReaderDocumentRuntime
  extends RitoCoreWasmReaderVersionedDocumentRuntime, RitoCoreWasmChapterLocalDocumentRuntime {
  free(): void;
  publication(): RitoCoreWasmPublicationInfo;
  pinnedFontPolicy(): RitoCoreWasmPinnedFontPolicySummary;
  /** Every family a `font-family` list can name. */
  fontCatalog(): RitoCoreWasmFontCatalog;
  /** The names in a CSS `font-family` list no family answers to. */
  unresolvedFontFamilies(familyList: string): string[];
  /** Adds host faces after the document's; returns the extended summary. */
  addHostFontFaces(
    faces: readonly RitoCoreWasmPinnedFontFaceInput[],
  ): RitoCoreWasmPinnedFontPolicySummary;
  /** Removes host faces by SHA-256; returns the remaining summary. */
  removeHostFontFaces(sha256s: readonly string[]): RitoCoreWasmPinnedFontPolicySummary;
  /** Hands a document opened from shards one content shard; returns its id. */
  supplyShard(shard: Uint8Array, key?: Uint8Array): number;
  /**
   * Every content shard, ordered for fetching ahead of need from the chapter
   * at `href`; empty for a document opened from an archive.
   */
  contentShardsNear(href: string): number[];
  readerWorkerPayload(
    request: RitoCoreWasmReaderWorkerRequest,
  ): RitoCoreWasmReaderWorkerResponsePayload;
}

export interface RitoCoreWasmReaderEngineRuntime {
  openDocument(
    bytes: Uint8Array,
    options?: RitoCoreWasmOpenDocumentOptions,
  ): RitoCoreWasmReaderDocumentRuntime;
  /** Opens from a skeleton shard; a pinned font policy is required. */
  openShardDocument(
    skeleton: Uint8Array,
    key: Uint8Array | undefined,
    options: RitoCoreWasmOpenDocumentOptions,
  ): RitoCoreWasmReaderDocumentRuntime;
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

export interface RitoCoreWasmReaderWorkerPinnedFontFaceInput {
  /** Dedicated transferable buffer; it must not be shared with another face or the EPUB. */
  readonly bytes: ArrayBuffer;
  readonly expectedSha256: string;
  readonly genericRole: RitoCoreWasmPinnedFontGenericRole;
  readonly language?: string | undefined;
}

export interface RitoCoreWasmReaderWorkerPinnedFontPolicyInput {
  readonly schemaVersion: 1;
  readonly faces: readonly RitoCoreWasmReaderWorkerPinnedFontFaceInput[];
}

export interface RitoCoreWasmReaderWorkerOpenOptions {
  readonly pinnedFontPolicy?: RitoCoreWasmReaderWorkerPinnedFontPolicyInput | undefined;
}

export interface RitoCoreWasmReaderWorkerPinnedFontFaceMetadata {
  readonly expectedSha256: string;
  readonly genericRole: RitoCoreWasmPinnedFontGenericRole;
  readonly language?: string | undefined;
}

export interface RitoCoreWasmReaderWorkerPinnedFontPolicyMetadata {
  readonly schemaVersion: 1;
  readonly faces: readonly RitoCoreWasmReaderWorkerPinnedFontFaceMetadata[];
}

export interface RitoCoreWasmReaderOpenResult {
  readonly publication: RitoCoreWasmPublicationInfo;
  readonly pinnedFontPolicy: RitoCoreWasmPinnedFontPolicySummary;
}

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
  /**
   * Planned frames that could be read. A frame that failed to read is
   * omitted (and noted in frameFaults) instead of aborting the window.
   */
  readonly frames: readonly RitoCoreWasmReaderFrameBuffer[];
  readonly spreads: readonly {
    readonly spreadIndex: number;
    readonly resources: readonly RitoCoreWasmReaderResourceBytes[];
    /** Terminal resource failures; callers must not retry this exact revision. */
    readonly missingResources: readonly RitoCoreWasmMissingResource[];
    /**
     * Resources whose content shard has not arrived. Paint without them and
     * read each again; the read loads its shard.
     */
    readonly pendingResources?: readonly RitoCoreWasmPendingResource[];
    /**
     * The spread's resources could not be enumerated at all (not terminal:
     * a later warm or an on-demand read may still succeed).
     */
    readonly prefetchError?: string;
  }[];
  /** Planned frames that failed to read, kept observable for diagnostics. */
  readonly frameFaults?: readonly { readonly spreadIndex: number; readonly message: string }[];
}

export interface RitoCoreWasmReaderTocTarget {
  readonly entry: RitoCoreWasmTocEntry;
  readonly pageIndex: number;
  readonly spreadIndex: number;
}

type WorkerRequestId = { readonly id: number };

export type RitoCoreWasmReaderWorkerRequest = WorkerRequestId &
  (
    | {
        readonly kind: 'open';
        readonly data?: ArrayBuffer | undefined;
        /** Present instead of `data` for a publication opened from shards. */
        readonly skeleton?: ArrayBuffer | undefined;
        readonly skeletonKey?: Uint8Array | undefined;
        readonly pinnedFontPolicyMetadata?:
          | RitoCoreWasmReaderWorkerPinnedFontPolicyMetadata
          | undefined;
        readonly pinnedFontFaceBuffers?: readonly ArrayBuffer[] | undefined;
      }
    | RitoCoreWasmReaderVersionedWorkerRequestPayload
    | RitoCoreWasmReaderChapterLocalWorkerRequestPayload
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
    | {
        readonly kind: 'supplyShard';
        readonly shard: ArrayBuffer;
        readonly key?: Uint8Array | undefined;
      }
    | { readonly kind: 'contentShardsNear'; readonly href: string }
    | { readonly kind: 'fontCatalog' }
    | { readonly kind: 'unresolvedFontFamilies'; readonly familyList: string }
    | {
        readonly kind: 'addHostFontFaces';
        readonly faces: readonly RitoCoreWasmHostFontFaceInput[];
      }
    | { readonly kind: 'removeHostFontFaces'; readonly sha256s: readonly string[] }
    | { readonly kind: 'dispose' }
  );

export type RitoCoreWasmReaderWorkerResponsePayload =
  | { readonly kind: 'open'; readonly result: RitoCoreWasmReaderOpenResult }
  | RitoCoreWasmReaderVersionedWorkerResponse
  | RitoCoreWasmReaderChapterLocalWorkerResponse
  | { readonly kind: 'readResource'; readonly result: RitoCoreWasmReaderResourceBytes }
  | { readonly kind: 'warmFrameWindow'; readonly result: RitoCoreWasmReaderFrameWindowWarmResult }
  | { readonly kind: 'resolveLocator'; readonly result: RitoCoreWasmReaderTocTarget }
  | { readonly kind: 'search'; readonly result: RitoCoreWasmSearchResponse }
  | { readonly kind: 'releaseRevisionTransfers' }
  | { readonly kind: 'releaseRevision' }
  | { readonly kind: 'supplyShard'; readonly result: number }
  | { readonly kind: 'contentShardsNear'; readonly result: readonly number[] }
  | { readonly kind: 'fontCatalog'; readonly result: RitoCoreWasmFontCatalog }
  | { readonly kind: 'unresolvedFontFamilies'; readonly result: readonly string[] }
  | { readonly kind: 'addHostFontFaces'; readonly result: RitoCoreWasmPinnedFontPolicySummary }
  | { readonly kind: 'removeHostFontFaces'; readonly result: RitoCoreWasmPinnedFontPolicySummary }
  | { readonly kind: 'dispose'; readonly releasedDocument: boolean };
