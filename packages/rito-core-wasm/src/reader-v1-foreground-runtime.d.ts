import type { RitoReaderForegroundHandoffAckV1, RitoReaderForegroundHandoffV1 } from './types';

export declare function encodeRitoReaderForegroundHandoffV1(
  request: RitoReaderForegroundHandoffV1,
): Uint8Array;
export declare function decodeRitoReaderForegroundHandoffAckV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderForegroundHandoffAckV1;
