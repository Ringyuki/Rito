import type {
  RitoReaderBackgroundAdvance,
  RitoReaderBackgroundHandoffAck,
  RitoReaderBackgroundHandoff,
  RitoReaderBackgroundRequest,
} from './types';

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
