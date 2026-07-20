import type {
  RitoCoreWasmReaderV1WorkerClient,
  RitoReaderErrorCodeV1,
  RitoReaderV1WorkerLike,
} from './types';

export declare class RitoReaderErrorV1 extends Error {
  readonly code: RitoReaderErrorCodeV1;
  constructor(code: RitoReaderErrorCodeV1, message: string);
}

export declare function createRitoCoreWasmReaderV1WorkerClient(
  worker: RitoReaderV1WorkerLike,
  options?: {
    readonly yieldControl?: (() => Promise<void>) | undefined;
    readonly maxExactContinuationQuanta?: number | undefined;
    readonly maxAdjacentContinuationQuanta?: number | undefined;
  },
): RitoCoreWasmReaderV1WorkerClient;
