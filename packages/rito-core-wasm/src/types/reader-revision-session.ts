import type { RitoCoreWasmReaderFrameWindowWarmResult } from './reader-worker';
import type { RitoCoreWasmSourceLocator, RitoCoreWasmSourceLocatorResolution } from './interaction';
import type { RitoCoreWasmLayoutConfig } from './common';
import type {
  RitoCoreWasmRevisionHandle,
  RitoCoreWasmRevisionNavigation,
  RitoCoreWasmRevisionPresentation,
  RitoCoreWasmRevisionRelease,
  RitoCoreWasmRevisionSummary,
  RitoCoreWasmRevisionTransferRelease,
  RitoCoreWasmVersioned,
} from './revision';

export interface RitoCoreWasmReaderRevisionSessionClient {
  createRevision(
    layoutConfig: RitoCoreWasmLayoutConfig,
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

export type RitoCoreWasmReaderRevisionStartRequest = {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
} & (
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

export interface RitoCoreWasmReaderRevisionSnapshot {
  readonly generation: number;
  readonly revision: RitoCoreWasmRevisionSummary;
  /** Exact-version paint/navigation metadata without cumulative interaction aggregates. */
  readonly presentation: RitoCoreWasmRevisionPresentation;
  readonly navigation: RitoCoreWasmRevisionNavigation;
  readonly target: RitoCoreWasmReaderRevisionSnapshotTarget;
  /** Center spread whose exact-version frame window accompanies this snapshot. */
  readonly presentationSpreadIndex: number;
  readonly frameWindow?: RitoCoreWasmReaderFrameWindowWarmResult | undefined;
}

export type RitoCoreWasmReaderRevisionSnapshotTarget =
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

export interface RitoCoreWasmReaderAcceptedRevision {
  readonly generation: number;
  readonly revision: RitoCoreWasmRevisionSummary;
}

export interface RitoCoreWasmReaderRevisionSessionOptions {
  readonly onAcceptedRevision?:
    | ((accepted: RitoCoreWasmReaderAcceptedRevision) => void)
    | undefined;
}

export interface RitoCoreWasmReaderRevisionSession {
  /**
   * The session exclusively owns every accepted revision. Consumers must use
   * `cancel`/`dispose` and must never release a snapshot revision directly.
   */
  start(
    request: RitoCoreWasmReaderRevisionStartRequest,
  ): Promise<RitoCoreWasmReaderRevisionSnapshot>;
  /** Callers must close exact-read gates before retargeting. */
  ensureSpread(spreadIndex: number): Promise<RitoCoreWasmReaderRevisionSnapshot>;
  /** Callers must close exact-read gates before retargeting. */
  ensureLocator(locator: RitoCoreWasmSourceLocator): Promise<RitoCoreWasmReaderRevisionSnapshot>;
  /** Callers must close exact-read gates before retargeting. */
  complete(): Promise<RitoCoreWasmReaderRevisionSnapshot>;
  currentSnapshot(): RitoCoreWasmReaderRevisionSnapshot | undefined;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export declare function createRitoCoreWasmReaderRevisionSession(
  client: RitoCoreWasmReaderRevisionSessionClient,
  options?: RitoCoreWasmReaderRevisionSessionOptions,
): RitoCoreWasmReaderRevisionSession;
