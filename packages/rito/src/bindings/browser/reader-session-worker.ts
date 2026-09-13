import {
  createRitoCoreWasmReaderSessionWorkerHandler,
  initRitoCoreWasm,
  RitoReaderSession,
  type RitoReaderSessionWorkerScope,
} from '@ritojs/core-wasm';

createRitoCoreWasmReaderSessionWorkerHandler(
  globalThis as unknown as RitoReaderSessionWorkerScope,
  {
    initRitoCoreWasm: () => initRitoCoreWasm(),
    RitoReaderSession,
  },
);
