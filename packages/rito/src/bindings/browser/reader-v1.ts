import {
  createRitoCoreWasmReaderV1WorkerClient,
  type RitoCoreWasmReaderV1WorkerClient,
  type RitoReaderAdjacentDirectionV1,
  type RitoReaderArtifactRequestInputV1,
  type RitoReaderArtifactV1,
  type RitoReaderBackgroundAdvanceV1,
  type RitoReaderBackgroundHandoffAckV1,
  type RitoReaderLayoutV1,
  type RitoReaderLocatorV1,
  type RitoReaderPublicationV1,
  type RitoReaderResourceKindV1,
  type RitoReaderResourceV1,
  type RitoReaderErrorCodeV1,
  type RitoReaderForegroundHandoffAckV1,
  type RitoReaderSeekOverridesV1,
  type RitoReaderTextProfileV1,
  type RitoReaderV1WorkerLike,
  type RitoReaderWorkBudgetV1,
  RitoReaderErrorV1,
} from '@ritojs/core-wasm/decoder';

export { RitoReaderErrorV1 };

export type BrowserReaderArtifactV1 = RitoReaderArtifactV1;
export type BrowserReaderArtifactRequestV1 = RitoReaderArtifactRequestInputV1;
export type BrowserReaderErrorCodeV1 = RitoReaderErrorCodeV1;
export type BrowserReaderBackgroundAdvanceV1 = RitoReaderBackgroundAdvanceV1;
export type BrowserReaderBackgroundHandoffAckV1 = RitoReaderBackgroundHandoffAckV1;
export type BrowserReaderForegroundHandoffAckV1 = RitoReaderForegroundHandoffAckV1;
export type BrowserReaderLayoutV1 = RitoReaderLayoutV1;
export type BrowserReaderLocatorV1 = RitoReaderLocatorV1;
export type BrowserReaderPublicationV1 = RitoReaderPublicationV1;
export type BrowserReaderResourceV1 = RitoReaderResourceV1;
export type BrowserReaderWorkBudgetV1 = RitoReaderWorkBudgetV1;
export type BrowserReaderAdjacentDirectionV1 = RitoReaderAdjacentDirectionV1;
export type BrowserReaderResourceKindV1 = RitoReaderResourceKindV1;
export type BrowserReaderTextProfileV1 = RitoReaderTextProfileV1;
export type BrowserReaderSeekOverridesV1 = RitoReaderSeekOverridesV1;

export interface BrowserReaderV1OpenOptions {
  readonly initialLocator: BrowserReaderLocatorV1;
  readonly layout: BrowserReaderLayoutV1;
  readonly work: BrowserReaderWorkBudgetV1;
  readonly textProfile?: BrowserReaderTextProfileV1 | undefined;
}

export interface BrowserReaderV1Session {
  readonly sessionId: bigint;
  /**
   * The requested locator's unadopted candidate, never an implicit page-one
   * artifact. Prepare its resources, verify it is still latest, then call
   * adoptForegroundCandidate(undefined, id).
   */
  readonly initialArtifact: BrowserReaderArtifactV1;
  /** Reads Core's immutable publication metadata, spine, and nested table of contents. */
  readPublication(): Promise<BrowserReaderPublicationV1>;
  /**
   * Returns an unadopted incoming candidate and keeps the source live. Prepare
   * and adopt the candidate before painting; release the source only after the
   * host's page-turn animation finishes.
   */
  requestAdjacent(
    fromArtifactId: bigint,
    direction: BrowserReaderAdjacentDirectionV1,
    work?: BrowserReaderWorkBudgetV1,
  ): Promise<BrowserReaderArtifactV1>;
  /** Returns an unadopted latest-wins candidate sharing the adjacent foreground lane. */
  requestArtifact(request: BrowserReaderArtifactRequestV1): Promise<BrowserReaderArtifactV1>;
  seek(
    locator: BrowserReaderLocatorV1,
    overrides?: BrowserReaderSeekOverridesV1,
  ): Promise<BrowserReaderArtifactV1>;
  /**
   * Atomically commits a prepared, still-latest candidate. Pass undefined only
   * for the initial visible artifact; replacements must name the old visible.
   */
  adoptForegroundCandidate(
    expectedVisibleArtifactId: bigint | undefined,
    candidateArtifactId: bigint,
  ): Promise<BrowserReaderForegroundHandoffAckV1>;
  /** Executes one cooperative publication quantum and never schedules another by itself. */
  advanceBackgroundOnce(
    expectedVisibleArtifactId: bigint,
    maxTopLevelNodesPerQuantum: number,
  ): Promise<BrowserReaderBackgroundAdvanceV1>;
  /** Keeps the replaced artifact live for the host's animation lifecycle. */
  adoptBackgroundCandidate(
    expectedVisibleArtifactId: bigint,
    candidateArtifactId: bigint,
  ): Promise<BrowserReaderBackgroundHandoffAckV1>;
  readResource(
    artifactId: bigint,
    kind: BrowserReaderResourceKindV1,
    href: string,
  ): Promise<BrowserReaderResourceV1>;
  release(artifactId: bigint): Promise<boolean>;
  dispose(): Promise<void>;
}

export async function openBrowserReaderV1(
  /** Ownership is transferred to the dedicated Reader v1 Worker. */
  publication: ArrayBuffer,
  options: BrowserReaderV1OpenOptions,
): Promise<BrowserReaderV1Session> {
  return openBrowserReaderV1WithWorker(createBrowserReaderV1Worker(), publication, options);
}

export async function openBrowserReaderV1WithWorker(
  worker: RitoReaderV1WorkerLike,
  publication: ArrayBuffer,
  options: BrowserReaderV1OpenOptions,
): Promise<BrowserReaderV1Session> {
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const initialRequest: RitoReaderArtifactRequestInputV1 = {
    layout: options.layout,
    locator: options.initialLocator,
    work: options.work,
    textProfile: options.textProfile ?? 'platform-string-runs',
  };
  try {
    const initialArtifact = await client.open(publication, initialRequest);
    return browserReaderV1Session(client, initialArtifact);
  } catch (error: unknown) {
    await client.dispose().catch(() => undefined);
    throw error;
  }
}

function browserReaderV1Session(
  client: RitoCoreWasmReaderV1WorkerClient,
  initialArtifact: BrowserReaderArtifactV1,
): BrowserReaderV1Session {
  const backgroundClient = client as RitoCoreWasmReaderV1WorkerClient &
    Pick<BrowserReaderV1Session, 'advanceBackgroundOnce' | 'adoptBackgroundCandidate'>;
  const publicationClient = client as RitoCoreWasmReaderV1WorkerClient &
    Pick<BrowserReaderV1Session, 'readPublication'>;
  return {
    sessionId: client.sessionId,
    initialArtifact,
    readPublication: () => publicationClient.readPublication(),
    requestAdjacent: (...args) => client.requestAdjacent(...args),
    requestArtifact: (...args) => client.requestArtifact(...args),
    seek: (...args) => client.seek(...args),
    adoptForegroundCandidate: (...args) => client.adoptForegroundCandidate(...args),
    advanceBackgroundOnce: (...args) => backgroundClient.advanceBackgroundOnce(...args),
    adoptBackgroundCandidate: (...args) => backgroundClient.adoptBackgroundCandidate(...args),
    readResource: (...args) => client.readResource(...args),
    release: (...args) => client.release(...args),
    dispose: () => client.dispose(),
  };
}

function createBrowserReaderV1Worker(): Worker {
  return new Worker(new URL('./reader-v1-worker-entry.mjs', import.meta.url), {
    type: 'module',
    name: 'rito-browser-reader-v1',
  });
}
