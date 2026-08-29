import type {
  RitoReaderAdjacentDirectionV1,
  RitoReaderArtifactRequestInputV1,
  RitoReaderArtifactV1,
  RitoReaderBackgroundAdvanceV1,
  RitoReaderBackgroundHandoffAckV1,
  RitoReaderForegroundHandoffAckV1,
  RitoReaderLayoutV1,
  RitoReaderLocatorV1,
  RitoReaderPublicationV1,
  RitoReaderResourceKindV1,
  RitoReaderResourceV1,
  RitoReaderTextProfileV1,
  RitoReaderWorkBudgetV1,
} from './reader-v1';

export type RitoReaderErrorCodeV1 =
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

export interface RitoReaderSeekOverridesV1 {
  readonly layout?: RitoReaderLayoutV1 | undefined;
  readonly work?: RitoReaderWorkBudgetV1 | undefined;
  readonly textProfile?: RitoReaderTextProfileV1 | undefined;
}

/**
 * Pinned fallback faces for a reader-v1 session. Chapter-local pagination
 * shapes with pinned faces only, so an open without a policy fails closed.
 * `metadataJson` and `faces` follow the same contract as
 * `RitoWasmDocument.openWithPinnedFontPolicy`.
 */
export interface RitoReaderV1PinnedFontPolicyInput {
  readonly metadataJson: string;
  readonly faces: readonly Uint8Array[];
}

export interface RitoCoreWasmReaderV1WorkerClient {
  readonly sessionId: bigint;
  /** Opens the worker-owned session and returns an unadopted initial candidate. */
  open(
    publication: ArrayBuffer,
    initialRequest: RitoReaderArtifactRequestInputV1,
    pinnedFontPolicy?: RitoReaderV1PinnedFontPolicyInput,
  ): Promise<RitoReaderArtifactV1>;
  /** Reads Core's immutable, session-owned RITOPUB1 metadata snapshot. */
  readPublication(): Promise<RitoReaderPublicationV1>;
  /** Cooperatively resumes one quantum per host turn and returns an unadopted candidate. */
  requestAdjacent(
    fromArtifactId: bigint,
    direction: RitoReaderAdjacentDirectionV1,
    work?: RitoReaderWorkBudgetV1,
  ): Promise<RitoReaderArtifactV1>;
  /** Returns an unadopted latest-wins candidate; only one foreground RPC advances. */
  requestArtifact(request: RitoReaderArtifactRequestInputV1): Promise<RitoReaderArtifactV1>;
  seek(
    locator: RitoReaderLocatorV1,
    overrides?: RitoReaderSeekOverridesV1,
  ): Promise<RitoReaderArtifactV1>;
  /** Commits one prepared, still-latest foreground candidate as visible. */
  adoptForegroundCandidate(
    expectedVisibleArtifactId: bigint | undefined,
    candidateArtifactId: bigint,
  ): Promise<RitoReaderForegroundHandoffAckV1>;
  /** Runs exactly one host-scheduled publication quantum; never loops automatically. */
  advanceBackgroundOnce(
    expectedVisibleArtifactId: bigint,
    maxTopLevelNodesPerQuantum: number,
  ): Promise<RitoReaderBackgroundAdvanceV1>;
  /** Atomically adopts a pending candidate without releasing the replaced artifact. */
  adoptBackgroundCandidate(
    expectedVisibleArtifactId: bigint,
    candidateArtifactId: bigint,
  ): Promise<RitoReaderBackgroundHandoffAckV1>;
  readResource(
    artifactId: bigint,
    kind: RitoReaderResourceKindV1,
    href: string,
  ): Promise<RitoReaderResourceV1>;
  release(artifactId: bigint): Promise<boolean>;
  dispose(): Promise<void>;
}

export interface RitoReaderV1WorkerLike {
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

export interface RitoReaderV1WorkerScope {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
}

export interface RitoReaderV1RawSession {
  publicationV1(): Uint8Array;
  hasPendingExactSeekV1(): boolean;
  hasPendingAdjacentV1(): boolean;
  requestArtifactV1(request: Uint8Array): Uint8Array;
  requestAdjacentV1(request: Uint8Array): Uint8Array;
  adoptForegroundCandidateV1(request: Uint8Array): Uint8Array;
  advanceBackgroundOnceV1(request: Uint8Array): Uint8Array;
  adoptBackgroundCandidateV1(request: Uint8Array): Uint8Array;
  readResourceV1(artifactId: bigint, kind: number, href: string): Uint8Array;
  releaseArtifactV1(artifactId: bigint): boolean;
  disposeV1(): boolean;
  free?(): void;
}

export interface RitoReaderV1WorkerHandlerDependencies {
  readonly initRitoCoreWasm: () => Promise<unknown>;
  readonly RitoReaderSessionV1: (new (
    publication: Uint8Array,
    sessionId: bigint,
  ) => RitoReaderV1RawSession) & {
    openWithPinnedFontPolicy(
      publication: Uint8Array,
      sessionId: bigint,
      metadataJson: string,
      faces: readonly Uint8Array[],
    ): RitoReaderV1RawSession;
  };
}
