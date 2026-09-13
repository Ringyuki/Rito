import type {
  RitoReaderSessionWorkerHandlerDependencies,
  RitoReaderSessionWorkerScope,
} from './types';

export declare function createRitoCoreWasmReaderSessionWorkerHandler(
  scope: RitoReaderSessionWorkerScope,
  deps: RitoReaderSessionWorkerHandlerDependencies,
): void;
