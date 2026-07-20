import type { RitoCoreWasmFontVerticalMetricSample } from './common';
import type { RitoCoreWasmReaderFrameWindowWarmResult } from './reader-worker';
import type { RitoCoreWasmSourceLocator, RitoCoreWasmSourceLocatorResolution } from './interaction';
import type {
  RitoCoreWasmBoundedRevisionRequest,
  RitoCoreWasmCalibrateRevisionFontVerticalMetricsRequest,
  RitoCoreWasmContinueRevisionRequest,
  RitoCoreWasmContinueRevisionTowardSourceLocatorRequest,
  RitoCoreWasmRevisionAdvance,
  RitoCoreWasmRevisionHandle,
  RitoCoreWasmRevisionAdvanceWithTransferRelease,
  RitoCoreWasmRevisionAdvanceTowardSourceLocator,
  RitoCoreWasmRevisionNavigation,
  RitoCoreWasmRevisionFontVerticalMetricCalibrationWithTransferRelease,
  RitoCoreWasmRevisionPresentation,
  RitoCoreWasmRevisionRelease,
  RitoCoreWasmRevisionSummary,
  RitoCoreWasmRevisionTransferRelease,
  RitoCoreWasmRevisionWorkBudget,
  RitoCoreWasmVersioned,
} from './revision';

type RitoCoreWasmBatchedContinueRevisionRequest = RitoCoreWasmContinueRevisionRequest & {
  readonly maxQuanta?: number | undefined;
  readonly targetSpreadIndex?: number | undefined;
};

type RitoCoreWasmBatchedLocatorContinuationRequest =
  RitoCoreWasmContinueRevisionTowardSourceLocatorRequest & {
    readonly maxQuanta?: number | undefined;
  };

export interface RitoCoreWasmBoundedReaderSessionClient {
  createBoundedRevision(
    request: RitoCoreWasmBoundedRevisionRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionAdvance>>;
  continueRevision(
    request: RitoCoreWasmContinueRevisionRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionAdvance>>;
  continueRevisionAfterTransferRelease?(
    request: RitoCoreWasmBatchedContinueRevisionRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionAdvanceWithTransferRelease>>;
  continueRevisionTowardSourceLocator?(
    request: RitoCoreWasmBatchedLocatorContinuationRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionAdvanceTowardSourceLocator>>;
  calibrateRevisionFontVerticalMetrics(
    request: RitoCoreWasmCalibrateRevisionFontVerticalMetricsRequest,
  ): Promise<
    RitoCoreWasmVersioned<RitoCoreWasmRevisionFontVerticalMetricCalibrationWithTransferRelease>
  >;
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

interface RitoCoreWasmBoundedReaderStartBase extends RitoCoreWasmBoundedRevisionRequest {
  /** Work quantum used only after the first snapshot; defaults to `budget`. */
  readonly growthBudget?: RitoCoreWasmRevisionWorkBudget | undefined;
}

export type RitoCoreWasmBoundedReaderStartRequest = RitoCoreWasmBoundedReaderStartBase &
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
  /**
   * Native continuation quanta grouped into one atomic worker dispatch.
   * A resolver is sampled once immediately before each atomic continuation dispatch.
   * Defaults to `1`; implementations reject resolved values outside their bounded limit.
   */
  readonly continuationBatchQuanta?: number | (() => number) | undefined;
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
  /** Rebuild vertical interaction geometry without replacing this worker or its layout key. */
  calibrateFontVerticalMetrics(
    samples: readonly RitoCoreWasmFontVerticalMetricSample[],
  ): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  currentSnapshot(): RitoCoreWasmBoundedReaderSnapshot | undefined;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export declare function createRitoCoreWasmBoundedReaderSession(
  client: RitoCoreWasmBoundedReaderSessionClient,
  options?: RitoCoreWasmBoundedReaderSessionOptions,
): RitoCoreWasmBoundedReaderSession;
