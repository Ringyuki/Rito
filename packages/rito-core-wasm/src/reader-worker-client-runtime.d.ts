import type {
  RitoCoreWasmReaderBindingRuntimeModule,
  RitoCoreWasmReaderSessionCache,
  RitoCoreWasmReaderWorkerHandlerDeps,
  RitoCoreWasmReaderWorkerClient,
  RitoCoreWasmReaderWorkerLike,
  RitoCoreWasmReaderWorkerScope,
  RitoCoreWasmWorkerReaderClientOptions,
} from './types';

export function createRitoCoreWasmWorkerReaderClient(
  worker: RitoCoreWasmReaderWorkerLike,
  cache?: RitoCoreWasmReaderSessionCache,
  options?: RitoCoreWasmWorkerReaderClientOptions,
): RitoCoreWasmReaderWorkerClient;

export function createRitoCoreWasmInProcessReaderClient(
  module: RitoCoreWasmReaderBindingRuntimeModule,
  cache?: RitoCoreWasmReaderSessionCache,
): RitoCoreWasmReaderWorkerClient;

export function createRitoCoreWasmReaderWorkerHandler(
  scope: RitoCoreWasmReaderWorkerScope,
  deps: RitoCoreWasmReaderWorkerHandlerDeps,
): void;
