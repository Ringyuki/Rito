import {
  createRitoCoreWasmReaderSessionWorkerClient,
  type RitoCoreWasmReaderSessionWorkerClient,
  type RitoReaderAdjacentDirection,
  type RitoReaderArtifactRequestInput,
  type RitoReaderArtifact,
  type RitoReaderBackgroundAdvance,
  type RitoReaderBackgroundHandoffAck,
  type RitoReaderLayout,
  type RitoReaderLocator,
  type RitoReaderPublication,
  type RitoReaderResourceKind,
  type RitoReaderResource,
  type RitoReaderErrorCode,
  type RitoReaderForegroundHandoffAck,
  type RitoReaderSeekOverrides,
  type RitoReaderTextProfile,
  type RitoReaderSessionWorkerLike,
  type RitoReaderAnnotationRequest,
  type RitoReaderAnnotationResponse,
  type RitoReaderExactSourceRangeResolution,
  type RitoReaderFootnote,
  type RitoReaderNavigationRequest,
  type RitoReaderNavigationResult,
  type RitoReaderSearchResponse,
  type RitoReaderSourceRange,
  type RitoReaderTextInteractionQuery,
  type RitoReaderTextInteractionResponse,
  type RitoReaderTextPosition,
  type RitoReaderTextRangeGeometry,
  RitoReaderError,
} from '@ritojs/core-wasm/decoder';

export { RitoReaderError };

export type BrowserReaderArtifact = RitoReaderArtifact;
export type BrowserReaderArtifactRequest = RitoReaderArtifactRequestInput;
export type BrowserReaderErrorCode = RitoReaderErrorCode;
export type BrowserReaderBackgroundAdvance = RitoReaderBackgroundAdvance;
export type BrowserReaderBackgroundHandoffAck = RitoReaderBackgroundHandoffAck;
export type BrowserReaderForegroundHandoffAck = RitoReaderForegroundHandoffAck;
export type BrowserReaderLayout = RitoReaderLayout;
export type BrowserReaderLocator = RitoReaderLocator;
export type BrowserReaderPublication = RitoReaderPublication;
export type BrowserReaderResource = RitoReaderResource;
export type BrowserReaderAdjacentDirection = RitoReaderAdjacentDirection;
export type BrowserReaderResourceKind = RitoReaderResourceKind;
export type BrowserReaderTextProfile = RitoReaderTextProfile;
export type BrowserReaderSeekOverrides = RitoReaderSeekOverrides;
export type BrowserReaderFootnote = RitoReaderFootnote;
export type BrowserReaderSearchResponse = RitoReaderSearchResponse;
export type BrowserReaderTextPosition = RitoReaderTextPosition;
export type BrowserReaderTextRangeGeometry = RitoReaderTextRangeGeometry;
export type BrowserReaderSourceRange = RitoReaderSourceRange;
export type BrowserReaderExactSourceRangeResolution = RitoReaderExactSourceRangeResolution;
export type BrowserReaderTextInteractionQuery = RitoReaderTextInteractionQuery;
export type BrowserReaderTextInteractionResponse = RitoReaderTextInteractionResponse;
export type BrowserReaderAnnotationQuery = RitoReaderAnnotationRequest['query'];
export type BrowserReaderAnnotationResponse = RitoReaderAnnotationResponse;
export type BrowserReaderNavigationQuery = RitoReaderNavigationRequest['query'];
export type BrowserReaderNavigationResult = RitoReaderNavigationResult;

export interface BrowserReaderSessionOpenOptions {
  readonly initialLocator: BrowserReaderLocator;
  readonly layout: BrowserReaderLayout;
  readonly textProfile?: BrowserReaderTextProfile | undefined;
  /**
   * Pinned fallback faces. Chapter-local pagination shapes with pinned
   * faces only, so an open without a policy fails closed in the engine.
   */
  readonly pinnedFontPolicy?:
    | { readonly metadataJson: string; readonly faces: readonly Uint8Array[] }
    | undefined;
}

export interface BrowserReaderSession {
  readonly sessionId: bigint;
  /**
   * The requested locator's unadopted candidate, never an implicit page-one
   * artifact. Prepare its resources, verify it is still latest, then call
   * adoptForegroundCandidate(undefined, id).
   */
  readonly initialArtifact: BrowserReaderArtifact;
  /** Reads Core's immutable publication metadata, spine, and nested table of contents. */
  readPublication(): Promise<BrowserReaderPublication>;
  /**
   * Returns an unadopted incoming candidate and keeps the source live. Prepare
   * and adopt the candidate before painting; release the source only after the
   * host's page-turn animation finishes.
   */
  requestAdjacent(
    fromArtifactId: bigint,
    direction: BrowserReaderAdjacentDirection,
  ): Promise<BrowserReaderArtifact>;
  /** Returns an unadopted latest-wins candidate sharing the adjacent foreground lane. */
  requestArtifact(request: BrowserReaderArtifactRequest): Promise<BrowserReaderArtifact>;
  seek(
    locator: BrowserReaderLocator,
    overrides?: BrowserReaderSeekOverrides,
  ): Promise<BrowserReaderArtifact>;
  /**
   * Atomically commits a prepared, still-latest candidate. Pass undefined only
   * for the initial visible artifact; replacements must name the old visible.
   */
  adoptForegroundCandidate(
    expectedVisibleArtifactId: bigint | undefined,
    candidateArtifactId: bigint,
  ): Promise<BrowserReaderForegroundHandoffAck>;
  /** Executes one cooperative publication quantum and never schedules another by itself. */
  advanceBackgroundOnce(
    expectedVisibleArtifactId: bigint,
    maxTopLevelNodesPerQuantum: number,
  ): Promise<BrowserReaderBackgroundAdvance>;
  /** Keeps the replaced artifact live for the host's animation lifecycle. */
  adoptBackgroundCandidate(
    expectedVisibleArtifactId: bigint,
    candidateArtifactId: bigint,
  ): Promise<BrowserReaderBackgroundHandoffAck>;
  readResource(
    artifactId: bigint,
    kind: BrowserReaderResourceKind,
    href: string,
  ): Promise<BrowserReaderResource>;
  /**
   * The adjacent spread as a read-only artifact with no foreground effect,
   * for a host that previews a page turn under a gesture. Release it, or
   * make it visible with {@link commitPeekedArtifact}.
   */
  peekAdjacent(
    fromArtifactId: bigint,
    direction: BrowserReaderAdjacentDirection,
  ): Promise<BrowserReaderArtifact>;
  /** Makes a peeked artifact visible, superseding every foreground request in flight. */
  commitPeekedArtifact(
    expectedVisibleArtifactId: bigint | undefined,
    candidateArtifactId: bigint,
  ): Promise<BrowserReaderForegroundHandoffAck>;
  readFootnote(artifactId: bigint, key: string): Promise<BrowserReaderFootnote>;
  /** Searches the revision behind the artifact; a zero or absent `limit` is unbounded. */
  search(
    artifactId: bigint,
    options: {
      readonly query: string;
      readonly caseSensitive?: boolean | undefined;
      readonly wholeWord?: boolean | undefined;
      readonly limit?: number | undefined;
    },
  ): Promise<BrowserReaderSearchResponse>;
  textRangeGeometry(
    artifactId: bigint,
    pageIndex: number,
    start: BrowserReaderTextPosition,
    end: BrowserReaderTextPosition,
  ): Promise<BrowserReaderTextRangeGeometry>;
  /** Where a durable source range lands on the pages the artifact draws. */
  exactSourceRange(
    artifactId: bigint,
    href: string,
    range: BrowserReaderSourceRange,
  ): Promise<BrowserReaderExactSourceRangeResolution>;
  /** Caret, range, point-range and movement selection, answered by the engine. */
  textInteraction(
    artifactId: bigint,
    query: BrowserReaderTextInteractionQuery,
  ): Promise<BrowserReaderTextInteractionResponse>;
  /** Builds an annotation target for a source range, or locates a stored one by its JSON. */
  annotation(query: BrowserReaderAnnotationQuery): Promise<BrowserReaderAnnotationResponse>;
  /** The TOC entry at a page or position, where a locator lands, or two positions' order. */
  navigation(query: BrowserReaderNavigationQuery): Promise<BrowserReaderNavigationResult>;
  release(artifactId: bigint): Promise<boolean>;
  dispose(): Promise<void>;
}

export async function openBrowserReaderSession(
  /** Ownership is transferred to the dedicated reader session Worker. */
  publication: ArrayBuffer,
  options: BrowserReaderSessionOpenOptions,
): Promise<BrowserReaderSession> {
  return openBrowserReaderSessionWithWorker(
    createBrowserReaderSessionWorker(),
    publication,
    options,
  );
}

export async function openBrowserReaderSessionWithWorker(
  worker: RitoReaderSessionWorkerLike,
  publication: ArrayBuffer,
  options: BrowserReaderSessionOpenOptions,
): Promise<BrowserReaderSession> {
  const client = createRitoCoreWasmReaderSessionWorkerClient(worker);
  const initialRequest: RitoReaderArtifactRequestInput = {
    // Paint snaps land on the backing grid the host rasterizes at; a
    // layout that does not say defaults to the window's ratio.
    layout: {
      ...options.layout,
      renderRatio: options.layout.renderRatio ?? defaultRenderRatio(),
    },
    locator: options.initialLocator,
    textProfile: options.textProfile ?? 'platform-string-runs',
  };
  try {
    const initialArtifact = await client.open(
      publication,
      initialRequest,
      options.pinnedFontPolicy,
    );
    return browserReaderSession(client, initialArtifact);
  } catch (error: unknown) {
    await client.dispose().catch(() => undefined);
    throw error;
  }
}

function browserReaderSession(
  client: RitoCoreWasmReaderSessionWorkerClient,
  initialArtifact: BrowserReaderArtifact,
): BrowserReaderSession {
  const backgroundClient = client as RitoCoreWasmReaderSessionWorkerClient &
    Pick<BrowserReaderSession, 'advanceBackgroundOnce' | 'adoptBackgroundCandidate'>;
  const publicationClient = client as RitoCoreWasmReaderSessionWorkerClient &
    Pick<BrowserReaderSession, 'readPublication'>;
  return {
    sessionId: client.sessionId,
    initialArtifact,
    readPublication: () => publicationClient.readPublication(),
    requestAdjacent: (...args) => client.requestAdjacent(...args),
    requestArtifact: (request) =>
      client.requestArtifact({
        ...request,
        layout: {
          ...request.layout,
          renderRatio: request.layout.renderRatio ?? defaultRenderRatio(),
        },
      }),
    seek: (...args) => client.seek(...args),
    adoptForegroundCandidate: (...args) => client.adoptForegroundCandidate(...args),
    advanceBackgroundOnce: (...args) => backgroundClient.advanceBackgroundOnce(...args),
    adoptBackgroundCandidate: (...args) => backgroundClient.adoptBackgroundCandidate(...args),
    readResource: (...args) => client.readResource(...args),
    peekAdjacent: (...args) => client.peekAdjacent(...args),
    commitPeekedArtifact: (...args) => client.commitPeekedArtifact(...args),
    readFootnote: (...args) => client.readFootnote(...args),
    search: (...args) => client.search(...args),
    textRangeGeometry: (...args) => client.textRangeGeometry(...args),
    exactSourceRange: (...args) => client.exactSourceRange(...args),
    textInteraction: (...args) => client.textInteraction(...args),
    annotation: (query) => client.annotation(query),
    navigation: (query) => client.navigation(query),
    release: (...args) => client.release(...args),
    dispose: () => client.dispose(),
  };
}

function createBrowserReaderSessionWorker(): Worker {
  return new Worker(new URL('./reader-session-worker-entry.mjs', import.meta.url), {
    type: 'module',
    name: 'rito-browser-reader-session',
  });
}

function defaultRenderRatio(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio : 1;
}
