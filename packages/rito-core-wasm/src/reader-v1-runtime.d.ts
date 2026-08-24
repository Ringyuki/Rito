import type {
  RitoCoreWasmReaderV1WorkerClient,
  RitoReaderAdjacentRequestV1,
  RitoReaderArtifactRequestV1,
  RitoReaderArtifactV1,
  RitoReaderBackgroundAdvanceV1,
  RitoReaderBackgroundHandoffAckV1,
  RitoReaderBackgroundHandoffV1,
  RitoReaderBackgroundRequestV1,
  RitoReaderDisplayListV1,
  RitoReaderErrorCodeV1,
  RitoReaderForegroundHandoffAckV1,
  RitoReaderForegroundHandoffV1,
  RitoReaderPublicationV1,
  RitoReaderResourceV1,
  RitoReaderV1WorkerHandlerDependencies,
  RitoReaderV1WorkerLike,
  RitoReaderV1WorkerScope,
} from './types';

export declare class RitoReaderWireErrorV1 extends Error {
  readonly code: 'invalid-wire';
  readonly offset: number;
}

export declare class RitoReaderErrorV1 extends Error {
  readonly code: RitoReaderErrorCodeV1;
  constructor(code: RitoReaderErrorCodeV1, message: string);
}

export declare function encodeRitoReaderArtifactRequestV1(
  request: RitoReaderArtifactRequestV1,
): Uint8Array;
export declare function encodeRitoReaderAdjacentRequestV1(
  request: RitoReaderAdjacentRequestV1,
): Uint8Array;
export declare function encodeRitoReaderForegroundHandoffV1(
  request: RitoReaderForegroundHandoffV1,
): Uint8Array;
export declare function decodeRitoReaderForegroundHandoffAckV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderForegroundHandoffAckV1;
export declare function encodeRitoReaderBackgroundRequestV1(
  request: RitoReaderBackgroundRequestV1,
): Uint8Array;
export declare function decodeRitoReaderBackgroundAdvanceV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderBackgroundAdvanceV1;
export declare function encodeRitoReaderBackgroundHandoffV1(
  request: RitoReaderBackgroundHandoffV1,
): Uint8Array;
export declare function decodeRitoReaderBackgroundHandoffAckV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderBackgroundHandoffAckV1;
export declare function decodeRitoReaderArtifactV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderArtifactV1;
export declare function decodeRitoReaderPublicationV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderPublicationV1;
export declare function decodeRitoReaderDisplayListV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderDisplayListV1;
export declare function decodeRitoReaderResourceV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderResourceV1;
export declare function createRitoCoreWasmReaderV1WorkerClient(
  worker: RitoReaderV1WorkerLike,
  options?: {
    readonly yieldControl?: (() => Promise<void>) | undefined;
    readonly maxExactContinuationQuanta?: number | undefined;
    readonly maxAdjacentContinuationQuanta?: number | undefined;
  },
): RitoCoreWasmReaderV1WorkerClient;
export declare function createRitoCoreWasmReaderV1WorkerHandler(
  scope: RitoReaderV1WorkerScope,
  deps: RitoReaderV1WorkerHandlerDependencies,
): void;
