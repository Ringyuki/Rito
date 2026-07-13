import type { RitoCoreWasmReaderFrameWindowWarmResult } from './reader-worker';
import type { RitoCoreWasmSourceLocator, RitoCoreWasmSourceLocatorResolution } from './interaction';
import type {
  RitoCoreWasmBoundedRevisionRequest,
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
  ): Promise<RitoCoreWasmVersioned<import('./revision').RitoCoreWasmRevisionAdvance>>;
  continueRevision(
    request: import('./revision').RitoCoreWasmContinueRevisionRequest,
  ): Promise<RitoCoreWasmVersioned<import('./revision').RitoCoreWasmRevisionAdvance>>;
  cancelRevision(
    request: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionSummary>>;
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

export interface RitoCoreWasmBoundedReaderStartRequest extends RitoCoreWasmBoundedRevisionRequest {
  /** Work quantum used only after the first snapshot; defaults to `budget`. */
  readonly growthBudget?: import('./revision').RitoCoreWasmRevisionWorkBudget | undefined;
  readonly targetSpreadIndex?: number | undefined;
}

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
  readonly yieldControl?: (() => void | Promise<void>) | undefined;
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
  /** Callers must close exact-read gates before requesting growth. */
  ensureSpread(spreadIndex: number): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  /** Callers must close exact-read gates before requesting growth. */
  ensureLocator(locator: RitoCoreWasmSourceLocator): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  /** Callers must close exact-read gates before requesting completion. */
  complete(): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  currentSnapshot(): RitoCoreWasmBoundedReaderSnapshot | undefined;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export declare function createRitoCoreWasmBoundedReaderSession(
  client: RitoCoreWasmBoundedReaderSessionClient,
  options?: RitoCoreWasmBoundedReaderSessionOptions,
): RitoCoreWasmBoundedReaderSession;
