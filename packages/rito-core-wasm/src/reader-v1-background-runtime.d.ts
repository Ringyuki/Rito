import type {
  RitoReaderBackgroundAdvanceV1,
  RitoReaderBackgroundHandoffAckV1,
  RitoReaderBackgroundHandoffV1,
  RitoReaderBackgroundRequestV1,
} from './types';

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
