import { decodeRitoFrameCommandBuffer as decodeFrameCommandBufferRuntime } from './frame-command-buffer-decoder-runtime.js';
import { decodeRitoRuntimeBundle as decodeRuntimeBundleRuntime } from './runtime-bundle-decoder-runtime.js';

export { normalizeRitoCoreWasmError, RitoCoreWasmError } from './core-wasm-error-runtime.js';
export { createRitoCoreWasmBoundedReaderSession } from './reader-bounded-session-runtime.js';
export {
  createRitoCoreWasmReaderChapterMap,
  createRitoCoreWasmReaderChapterTextIndexMap,
  createRitoCoreWasmReaderFootnoteMap,
  createRitoCoreWasmReaderManifestHrefMap,
  createRitoCoreWasmReaderPages,
  createRitoCoreWasmReaderSpreads,
  findRitoCoreWasmReaderActiveTocEntry,
  findRitoCoreWasmReaderSpreadContainingPage,
  findRitoCoreWasmReaderTocTarget,
} from './reader-compat-runtime.js';
export {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmReaderWorkerHandler,
  createRitoCoreWasmWorkerReaderClient,
} from './reader-worker-client-runtime.js';
export { getRitoCoreWasmStatus } from './status';
export type { RitoCoreWasmErrorCode, RitoCoreWasmErrorOptions } from './core-wasm-error-runtime.js';
export type * from './types';

export const decodeRitoFrameCommandBuffer = decodeFrameCommandBufferRuntime;
export const decodeRitoRuntimeBundle = decodeRuntimeBundleRuntime;
