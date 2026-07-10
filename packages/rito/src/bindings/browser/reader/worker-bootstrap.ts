import {
  createRitoCoreWasmReaderWorkerHandler,
  initRitoCoreWasmEngine,
  normalizeRitoCoreWasmError,
  type RitoCoreWasmReaderWorkerScope,
} from '@ritojs/core-wasm';

export function startBrowserReaderWorker(
  scope: RitoCoreWasmReaderWorkerScope = globalThis as unknown as RitoCoreWasmReaderWorkerScope,
): void {
  createRitoCoreWasmReaderWorkerHandler(scope, {
    initRitoCoreWasmEngine,
    normalizeRitoCoreWasmError,
  });
}
