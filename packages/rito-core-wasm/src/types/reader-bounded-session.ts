import type { RitoCoreWasmReaderFrameWindowWarmResult } from './reader-worker';
import type { RitoCoreWasmSourceLocator, RitoCoreWasmSourceLocatorResolution } from './interaction';
import type {
  RitoCoreWasmBoundedRevisionRequest,
  RitoCoreWasmRevisionAdvance,
  RitoCoreWasmRevisionHandle,
  RitoCoreWasmRevisionNavigation,
  RitoCoreWasmRevisionPresentation,
  RitoCoreWasmRevisionRelease,
  RitoCoreWasmRevisionSummary,
  RitoCoreWasmRevisionTransferRelease,
  RitoCoreWasmVersioned,
} from './revision';

export interface RitoCoreWasmBoundedReaderSessionClient {
  createBoundedRevision(
    request: RitoCoreWasmBoundedRevisionRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionAdvance>>;
  getRevisionPresentationAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionPresentation>>;
  warmFrameWindowAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmReaderFrameWindowWarmResult>>;
  resolveSourceLocatorAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    locator: RitoCoreWasmSourceLocator,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmSourceLocatorResolution>>;
  releaseRevisionTransfersAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmRevisionTransferRelease>;
  releaseRevisionAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmRevisionRelease>;
}

export type RitoCoreWasmBoundedReaderStartRequest = RitoCoreWasmBoundedRevisionRequest &
  (
    | {
        /** Durable source target resolved before the first snapshot is published. */
        readonly targetLocator: RitoCoreWasmSourceLocator;
        readonly targetSpreadIndex?: never;
      }
    | {
        readonly targetLocator?: never;
        readonly targetSpreadIndex?: number | undefined;
      }
  );

export interface RitoCoreWasmBoundedReaderSnapshot {
  readonly generation: number;
  readonly revision: RitoCoreWasmRevisionSummary;
  /** Exact-version paint/navigation metadata without cumulative interaction aggregates. */
  readonly presentation: RitoCoreWasmRevisionPresentation;
  readonly navigation: RitoCoreWasmRevisionNavigation;
  readonly target: RitoCoreWasmBoundedReaderSnapshotTarget;
  /** Center spread whose exact-version frame window accompanies this snapshot. */
  readonly presentationSpreadIndex: number;
  readonly frameWindow?: RitoCoreWasmReaderFrameWindowWarmResult | undefined;
}

export type RitoCoreWasmBoundedReaderSnapshotTarget =
  | {
      readonly kind: 'spread';
      readonly spreadIndex: number;
    }
  | {
      readonly kind: 'locator';
      readonly locator: RitoCoreWasmSourceLocator;
      readonly resolution: RitoCoreWasmSourceLocatorResolution;
    }
  | {
      readonly kind: 'complete';
    };

export interface RitoCoreWasmBoundedReaderAcceptedRevision {
  readonly generation: number;
  readonly revision: RitoCoreWasmRevisionSummary;
}

export interface RitoCoreWasmBoundedReaderSessionOptions {
  readonly onAcceptedRevision?:
    | ((accepted: RitoCoreWasmBoundedReaderAcceptedRevision) => void)
    | undefined;
}

export interface RitoCoreWasmBoundedReaderSession {
  /**
   * The session exclusively owns every accepted revision. Consumers must use
   * `cancel`/`dispose` and must never release a snapshot revision directly.
   */
  start(request: RitoCoreWasmBoundedReaderStartRequest): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  /** Callers must close exact-read gates before retargeting. */
  ensureSpread(spreadIndex: number): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  /** Callers must close exact-read gates before retargeting. */
  ensureLocator(locator: RitoCoreWasmSourceLocator): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  /** Callers must close exact-read gates before retargeting. */
  complete(): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  currentSnapshot(): RitoCoreWasmBoundedReaderSnapshot | undefined;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export declare function createRitoCoreWasmBoundedReaderSession(
  client: RitoCoreWasmBoundedReaderSessionClient,
  options?: RitoCoreWasmBoundedReaderSessionOptions,
): RitoCoreWasmBoundedReaderSession;
