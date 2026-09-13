import type {
  RitoCoreWasmReaderSessionWorkerClient,
  RitoReaderErrorCode,
  RitoReaderSessionWorkerLike,
} from './types';

export declare class RitoReaderError extends Error {
  readonly code: RitoReaderErrorCode;
  constructor(code: RitoReaderErrorCode, message: string);
}

export declare function createRitoCoreWasmReaderSessionWorkerClient(
  worker: RitoReaderSessionWorkerLike,
  options?: {
    readonly yieldControl?: (() => Promise<void>) | undefined;
    readonly maxAdjacentContinuationQuanta?: number | undefined;
  },
): RitoCoreWasmReaderSessionWorkerClient;
