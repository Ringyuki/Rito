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
export {
  decodeRitoReaderArtifactV1,
  decodeRitoReaderResourceV1,
} from './reader-v1-artifact-decoder-runtime.js';
export { decodeRitoReaderPublicationV1 } from './reader-v1-publication-runtime.js';
export { decodeRitoReaderDisplayListV1 } from './reader-v1-display-decoder-runtime.js';
export {
  encodeRitoReaderAdjacentRequestV1,
  encodeRitoReaderArtifactRequestV1,
} from './reader-v1-request-runtime.js';
export {
  decodeRitoReaderForegroundHandoffAckV1,
  encodeRitoReaderForegroundHandoffV1,
} from './reader-v1-foreground-runtime.js';
export {
  decodeRitoReaderBackgroundAdvanceV1,
  decodeRitoReaderBackgroundHandoffAckV1,
  encodeRitoReaderBackgroundHandoffV1,
  encodeRitoReaderBackgroundRequestV1,
} from './reader-v1-background-runtime.js';
export { createRitoCoreWasmReaderV1WorkerHandler } from './reader-v1-worker-runtime.js';
export {
  createRitoCoreWasmReaderV1WorkerClient,
  RitoReaderErrorV1,
} from './reader-v1-worker-client-runtime.js';
export { RitoReaderWireErrorV1 } from './reader-v1-wire-base-runtime.js';
export { getRitoCoreWasmStatus } from './status';
export type { RitoCoreWasmErrorCode, RitoCoreWasmErrorOptions } from './core-wasm-error-runtime.js';
export type * from './types';

export const decodeRitoFrameCommandBuffer = decodeFrameCommandBufferRuntime;
export const decodeRitoRuntimeBundle = decodeRuntimeBundleRuntime;
