import type { RitoCoreWasmReaderFrameWindowWarmResult } from './reader-worker';
import type {
  RitoCoreWasmBoundedRevisionRequest,
  RitoCoreWasmRevisionHandle,
  RitoCoreWasmRevisionNavigation,
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
  getRevisionNavigationAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionNavigation>>;
  warmFrameWindowAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmReaderFrameWindowWarmResult>>;
  releaseRevisionTransfersAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmRevisionTransferRelease>;
  releaseRevisionAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmRevisionRelease>;
}

export interface RitoCoreWasmBoundedReaderStartRequest extends RitoCoreWasmBoundedRevisionRequest {
  readonly targetSpreadIndex?: number | undefined;
}

export interface RitoCoreWasmBoundedReaderSnapshot {
  readonly generation: number;
  readonly revision: RitoCoreWasmRevisionSummary;
  readonly navigation: RitoCoreWasmRevisionNavigation;
  readonly requestedSpreadIndex: number;
  readonly frameWindow?: RitoCoreWasmReaderFrameWindowWarmResult | undefined;
}

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
  start(request: RitoCoreWasmBoundedReaderStartRequest): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  ensureSpread(spreadIndex: number): Promise<RitoCoreWasmBoundedReaderSnapshot>;
  currentSnapshot(): RitoCoreWasmBoundedReaderSnapshot | undefined;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export declare function createRitoCoreWasmBoundedReaderSession(
  client: RitoCoreWasmBoundedReaderSessionClient,
  options?: RitoCoreWasmBoundedReaderSessionOptions,
): RitoCoreWasmBoundedReaderSession;
