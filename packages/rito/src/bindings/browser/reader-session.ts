import {
  createRitoCoreWasmReaderSessionWorkerClient,
  type RitoCoreWasmReaderSessionWorkerClient,
  type RitoReaderArtifactRequestInput,
  type RitoReaderArtifact,
  type RitoReaderBackgroundAdvance,
  type RitoReaderBackgroundHandoffAck,
  type RitoReaderLayout,
  type RitoReaderLocator,
  type RitoReaderPublication,
  type RitoReaderResourceKind,
  type RitoReaderResource,
  type RitoReaderForegroundHandoffAck,
  type RitoReaderTextProfile,
  type RitoReaderSessionWorkerLike,
  type RitoReaderAnnotationRequest,
  type RitoReaderAnnotationResponse,
  type RitoReaderExactSourceRangeResolution,
  type RitoReaderGeometryOptions,
  type RitoReaderFootnote,
  type RitoReaderNavigationRequest,
  type RitoReaderNavigationResult,
  type RitoReaderSearchResponse,
  type RitoReaderSourceRange,
  type RitoReaderTextInteractionQuery,
  type RitoReaderTextInteractionResponse,
  RitoReaderError,
} from '@ritojs/core-wasm/decoder';

import type { ReaderFontCatalog, ReaderHostFontFace, ReaderPublication } from '../../reader';

export { RitoReaderError };

export type BrowserReaderArtifact = RitoReaderArtifact;
export type BrowserReaderArtifactRequest = RitoReaderArtifactRequestInput;
export type BrowserReaderBackgroundAdvance = RitoReaderBackgroundAdvance;
export type BrowserReaderBackgroundHandoffAck = RitoReaderBackgroundHandoffAck;
export type BrowserReaderForegroundHandoffAck = RitoReaderForegroundHandoffAck;
export type BrowserReaderLayout = RitoReaderLayout;
export type BrowserReaderLocator = RitoReaderLocator;
export type BrowserReaderPublication = RitoReaderPublication;
export type BrowserReaderResource = RitoReaderResource;
export type BrowserReaderResourceKind = RitoReaderResourceKind;
export type BrowserReaderTextProfile = RitoReaderTextProfile;
export type BrowserReaderFootnote = RitoReaderFootnote;
export type BrowserReaderSearchResponse = RitoReaderSearchResponse;
export type BrowserReaderSourceRange = RitoReaderSourceRange;
export type BrowserReaderExactSourceRangeResolution = RitoReaderExactSourceRangeResolution;
export type BrowserReaderTextInteractionQuery = RitoReaderTextInteractionQuery;
export type BrowserReaderGeometryOptions = RitoReaderGeometryOptions;
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

/**
 * The reader session as the browser reader uses it. It hands out artifacts
 * that are not adopted yet and must each be shown or released, so it is
 * internal: `session-reader/artifacts.ts` is its one caller of those
 * methods, inside the reader's queue.
 */
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
  /** Every family a `font-family` choice can name in this publication. */
  fonts(): Promise<ReaderFontCatalog>;
  /** The names in a CSS `font-family` list no family answers to (layout skips them). */
  unresolvedFontFamilies(familyList: string): Promise<readonly string[]>;
  /**
   * Adds host faces after the session's; their bytes are copied. Artifacts
   * already published keep their layout; the next request lays out with the
   * new faces, and its artifact lists them among the fonts to register.
   */
  addFontFaces(faces: readonly ReaderHostFontFace[]): Promise<void>;
  /** Removes host faces by SHA-256; at least one must remain. */
  removeFontFaces(sha256s: readonly string[]): Promise<void>;
  /**
   * Marks publication faces the page could not load, by the family an
   * artifact lists them under: the next request lays out without them.
   */
  markFontFamiliesUnavailable(families: readonly string[]): Promise<void>;
  /**
   * Lays out for a request and returns its unadopted candidate; the newest
   * request wins. The caller prepares it and has the session show it with
   * {@link adoptForegroundCandidate}, or releases it.
   */
  requestArtifact(request: BrowserReaderArtifactRequest): Promise<BrowserReaderArtifact>;
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
    maxPagesPerQuantum: number,
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
   * One spread of the revision behind an artifact, by its position in that
   * revision's page table (the `layout` navigation query lists them), with
   * no layout work and no foreground effect. Release it, or make it visible
   * with {@link commitPeekedArtifact}.
   */
  peekSpread(fromArtifactId: bigint, spreadIndex: number): Promise<BrowserReaderArtifact>;
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
  /**
   * Where a durable source range lands: on the pages the artifact draws,
   * or with `everyPage` on every page it covers.
   */
  exactSourceRange(
    artifactId: bigint,
    href: string,
    range: BrowserReaderSourceRange,
    options?: BrowserReaderGeometryOptions,
  ): Promise<BrowserReaderExactSourceRangeResolution>;
  /** Caret, range, point-range and movement selection, answered by the engine. */
  textInteraction(
    artifactId: bigint,
    query: BrowserReaderTextInteractionQuery,
    options?: BrowserReaderGeometryOptions,
  ): Promise<BrowserReaderTextInteractionResponse>;
  /** Builds an annotation target for a source range, or locates a stored one by its JSON. */
  annotation(query: BrowserReaderAnnotationQuery): Promise<BrowserReaderAnnotationResponse>;
  /**
   * The TOC entry at a page or position, where a locator lands, two
   * positions' order, or the page table of the revision behind an artifact.
   */
  navigation(query: BrowserReaderNavigationQuery): Promise<BrowserReaderNavigationResult>;
  release(artifactId: bigint): Promise<boolean>;
  dispose(): Promise<void>;
}

export async function openBrowserReaderSession(
  /**
   * A whole EPUB, whose ownership is transferred to the dedicated reader
   * session Worker, or a publication split by `@ritojs/pack`: the session opens
   * from the skeleton and loads each content shard the first time a request
   * needs it (a sharded open requires `pinnedFontPolicy`).
   */
  publication: ReaderPublication,
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
  publication: ReaderPublication,
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
    requestArtifact: (request) =>
      client.requestArtifact({
        ...request,
        layout: {
          ...request.layout,
          renderRatio: request.layout.renderRatio ?? defaultRenderRatio(),
        },
      }),
    adoptForegroundCandidate: (...args) => client.adoptForegroundCandidate(...args),
    advanceBackgroundOnce: (...args) => backgroundClient.advanceBackgroundOnce(...args),
    adoptBackgroundCandidate: (...args) => backgroundClient.adoptBackgroundCandidate(...args),
    readResource: (...args) => client.readResource(...args),
    fonts: () => client.fontCatalog(),
    unresolvedFontFamilies: (familyList) => client.unresolvedFontFamilies(familyList),
    addFontFaces: async (faces) => {
      await client.addHostFontFaces(faces.map((face) => ({ ...face, bytes: face.bytes.slice(0) })));
    },
    removeFontFaces: async (sha256s) => {
      await client.removeHostFontFaces(sha256s);
    },
    markFontFamiliesUnavailable: (families) => client.markFontFamiliesUnavailable(families),
    peekSpread: (...args) => client.peekSpread(...args),
    commitPeekedArtifact: (...args) => client.commitPeekedArtifact(...args),
    readFootnote: (...args) => client.readFootnote(...args),
    search: (...args) => client.search(...args),
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
