import type {
  RitoCoreWasmReaderBindingRuntimeModule,
  RitoCoreWasmReaderWorkerHandlerDeps,
  RitoCoreWasmReaderWorkerClient,
  RitoCoreWasmReaderWorkerLike,
  RitoCoreWasmReaderWorkerScope,
} from './types';

export function createRitoCoreWasmWorkerReaderClient(
  worker: RitoCoreWasmReaderWorkerLike,
): RitoCoreWasmReaderWorkerClient;

export function createRitoCoreWasmInProcessReaderClient(
  module: RitoCoreWasmReaderBindingRuntimeModule,
): RitoCoreWasmReaderWorkerClient;

export function createRitoCoreWasmReaderWorkerHandler(
  scope: RitoCoreWasmReaderWorkerScope,
  deps: RitoCoreWasmReaderWorkerHandlerDeps,
): void;
