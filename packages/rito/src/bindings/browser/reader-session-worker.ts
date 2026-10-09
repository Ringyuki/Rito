import {
  createRitoCoreWasmReaderSessionWorkerHandler,
  initRitoCoreWasm,
  RitoReaderSession,
  type RitoReaderSessionWorkerScope,
} from '@ritojs/core-wasm';

export function startBrowserReaderSessionWorker(
  scope: RitoReaderSessionWorkerScope = globalThis as unknown as RitoReaderSessionWorkerScope,
): void {
  createRitoCoreWasmReaderSessionWorkerHandler(scope, {
    initRitoCoreWasm: () => initRitoCoreWasm(),
    RitoReaderSession,
  });
}
