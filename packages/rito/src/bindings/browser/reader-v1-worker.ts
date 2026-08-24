import {
  createRitoCoreWasmReaderV1WorkerHandler,
  initRitoCoreWasm,
  RitoReaderSessionV1,
  type RitoReaderV1WorkerScope,
} from '@ritojs/core-wasm';

createRitoCoreWasmReaderV1WorkerHandler(globalThis as unknown as RitoReaderV1WorkerScope, {
  initRitoCoreWasm: () => initRitoCoreWasm(),
  RitoReaderSessionV1,
});
