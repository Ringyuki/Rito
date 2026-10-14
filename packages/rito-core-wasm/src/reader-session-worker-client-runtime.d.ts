import type {
  RitoCoreWasmReaderSessionWorkerClient,
  RitoReaderErrorCode,
  RitoReaderSessionWorkerLike,
} from './types';

export declare class RitoReaderError extends Error {
  readonly code: RitoReaderErrorCode;
  /**
   * Present exactly for `resource-pending`: the content shards the request
   * waited on. The client supplies them through `loadShards` and retries
   * before reporting anything, so this reaches a caller only when the
   * supplied shards still did not satisfy the request.
   */
  readonly pendingShards?: readonly number[];
  constructor(code: RitoReaderErrorCode, message: string, pendingShards?: readonly number[]);
}

export declare function createRitoCoreWasmReaderSessionWorkerClient(
  worker: RitoReaderSessionWorkerLike,
  options?: {
    readonly yieldControl?: (() => Promise<void>) | undefined;
    readonly maxAdjacentContinuationQuanta?: number | undefined;
  },
): RitoCoreWasmReaderSessionWorkerClient;
