import type {
  RitoCoreWasmReaderSessionWorkerClient,
  RitoReaderAdjacentRequest,
  RitoReaderArtifactRequest,
  RitoReaderArtifact,
  RitoReaderBackgroundAdvance,
  RitoReaderBackgroundHandoffAck,
  RitoReaderBackgroundHandoff,
  RitoReaderBackgroundRequest,
  RitoReaderErrorCode,
  RitoReaderPrimitiveList,
  RitoReaderForegroundHandoffAck,
  RitoReaderForegroundHandoff,
  RitoReaderPublication,
  RitoReaderResource,
  RitoReaderSessionWorkerHandlerDependencies,
  RitoReaderSessionWorkerLike,
  RitoReaderSessionWorkerScope,
} from './types';

export declare class RitoReaderWireError extends Error {
  readonly code: 'invalid-wire';
  readonly offset: number;
}

export declare class RitoReaderError extends Error {
  readonly code: RitoReaderErrorCode;
  constructor(code: RitoReaderErrorCode, message: string);
}

export declare function encodeRitoReaderArtifactRequest(
  request: RitoReaderArtifactRequest,
): Uint8Array;
export declare function encodeRitoReaderAdjacentRequest(
  request: RitoReaderAdjacentRequest,
): Uint8Array;
export declare function encodeRitoReaderForegroundHandoff(
  request: RitoReaderForegroundHandoff,
): Uint8Array;
export declare function decodeRitoReaderForegroundHandoffAck(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderForegroundHandoffAck;
export declare function encodeRitoReaderBackgroundRequest(
  request: RitoReaderBackgroundRequest,
): Uint8Array;
export declare function decodeRitoReaderBackgroundAdvance(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderBackgroundAdvance;
export declare function encodeRitoReaderBackgroundHandoff(
  request: RitoReaderBackgroundHandoff,
): Uint8Array;
export declare function decodeRitoReaderBackgroundHandoffAck(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderBackgroundHandoffAck;
export declare function decodeRitoReaderArtifact(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderArtifact;
export declare function decodeRitoReaderPublication(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderPublication;
export declare const READER_V1_PRIMITIVE_LIST_FORMAT_VERSION: 2;
export declare function decodeRitoReaderPrimitiveList(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderPrimitiveList;
export declare function decodeRitoReaderResource(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderResource;
export declare function createRitoCoreWasmReaderSessionWorkerClient(
  worker: RitoReaderSessionWorkerLike,
  options?: {
    readonly yieldControl?: (() => Promise<void>) | undefined;
    readonly maxAdjacentContinuationQuanta?: number | undefined;
  },
): RitoCoreWasmReaderSessionWorkerClient;
export declare function createRitoCoreWasmReaderSessionWorkerHandler(
  scope: RitoReaderSessionWorkerScope,
  deps: RitoReaderSessionWorkerHandlerDependencies,
): void;
