import type {
  RitoReaderAdjacentDirection,
  RitoReaderArtifactRequestInput,
  RitoReaderArtifact,
  RitoReaderBackgroundAdvance,
  RitoReaderBackgroundHandoffAck,
  RitoReaderForegroundHandoffAck,
  RitoReaderLayout,
  RitoReaderLocator,
  RitoReaderPublication,
  RitoReaderResourceKind,
  RitoReaderResource,
  RitoReaderTextProfile,
} from './reader-session';

export type RitoReaderErrorCode =
  | 'invalid-session'
  | 'invalid-request'
  | 'invalid-layout'
  | 'invalid-locator'
  | 'unsupported-text-profile'
  | 'stale-request'
  | 'target-not-published'
  | 'unknown-artifact'
  | 'numeric-overflow'
  | 'invalid-wire'
  | 'engine-failure'
  | 'session-disposed'
  | 'request-busy'
  | 'request-capacity'
  | 'artifact-capacity';

export interface RitoReaderSeekOverrides {
  readonly layout?: RitoReaderLayout | undefined;
  readonly textProfile?: RitoReaderTextProfile | undefined;
}

/**
 * Pinned fallback faces for a reader session session. Chapter-local pagination
 * shapes with pinned faces only, so an open without a policy fails closed.
 * `metadataJson` and `faces` follow the same contract as
 * `RitoWasmDocument.openWithPinnedFontPolicy`.
 */
export interface RitoReaderSessionPinnedFontPolicyInput {
  readonly metadataJson: string;
  readonly faces: readonly Uint8Array[];
}

export interface RitoCoreWasmReaderSessionWorkerClient {
  readonly sessionId: bigint;
  /** Opens the worker-owned session and returns an unadopted initial candidate. */
  open(
    publication: ArrayBuffer,
    initialRequest: RitoReaderArtifactRequestInput,
    pinnedFontPolicy?: RitoReaderSessionPinnedFontPolicyInput,
  ): Promise<RitoReaderArtifact>;
  /** Reads Core's immutable, session-owned RITOPUB1 metadata snapshot. */
  readPublication(): Promise<RitoReaderPublication>;
  /** Cooperatively resumes one quantum per host turn and returns an unadopted candidate. */
  requestAdjacent(
    fromArtifactId: bigint,
    direction: RitoReaderAdjacentDirection,
  ): Promise<RitoReaderArtifact>;
  /** Returns an unadopted latest-wins candidate; only one foreground RPC advances. */
  requestArtifact(request: RitoReaderArtifactRequestInput): Promise<RitoReaderArtifact>;
  seek(
    locator: RitoReaderLocator,
    overrides?: RitoReaderSeekOverrides,
  ): Promise<RitoReaderArtifact>;
  /** Commits one prepared, still-latest foreground candidate as visible. */
  adoptForegroundCandidate(
    expectedVisibleArtifactId: bigint | undefined,
    candidateArtifactId: bigint,
  ): Promise<RitoReaderForegroundHandoffAck>;
  /** Runs exactly one host-scheduled publication quantum; never loops automatically. */
  advanceBackgroundOnce(
    expectedVisibleArtifactId: bigint,
    maxTopLevelNodesPerQuantum: number,
  ): Promise<RitoReaderBackgroundAdvance>;
  /** Atomically adopts a pending candidate without releasing the replaced artifact. */
  adoptBackgroundCandidate(
    expectedVisibleArtifactId: bigint,
    candidateArtifactId: bigint,
  ): Promise<RitoReaderBackgroundHandoffAck>;
  readResource(
    artifactId: bigint,
    kind: RitoReaderResourceKind,
    href: string,
  ): Promise<RitoReaderResource>;
  release(artifactId: bigint): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface RitoReaderSessionWorkerLike {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'error', listener: (event: { readonly message?: string }) => void): void;
  addEventListener(type: 'messageerror', listener: () => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(
    type: 'error',
    listener: (event: { readonly message?: string }) => void,
  ): void;
  removeEventListener(type: 'messageerror', listener: () => void): void;
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  terminate(): void;
}

export interface RitoReaderSessionWorkerScope {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
}

export interface RitoReaderRawSession {
  publication(): Uint8Array;
  hasPendingAdjacent(): boolean;
  requestArtifact(request: Uint8Array): Uint8Array;
  requestAdjacent(request: Uint8Array): Uint8Array;
  adoptForegroundCandidate(request: Uint8Array): Uint8Array;
  advanceBackgroundOnce(request: Uint8Array): Uint8Array;
  adoptBackgroundCandidate(request: Uint8Array): Uint8Array;
  readResource(artifactId: bigint, kind: number, href: string): Uint8Array;
  releaseArtifact(artifactId: bigint): boolean;
  dispose(): boolean;
  free?(): void;
}

export interface RitoReaderSessionWorkerHandlerDependencies {
  readonly initRitoCoreWasm: () => Promise<unknown>;
  readonly RitoReaderSession: (new (
    publication: Uint8Array,
    sessionId: bigint,
  ) => RitoReaderRawSession) & {
    openWithPinnedFontPolicy(
      publication: Uint8Array,
      sessionId: bigint,
      metadataJson: string,
      faces: readonly Uint8Array[],
    ): RitoReaderRawSession;
  };
}
