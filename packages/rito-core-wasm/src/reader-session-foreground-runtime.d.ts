import type { RitoReaderForegroundHandoffAck, RitoReaderForegroundHandoff } from './types';

export declare function encodeRitoReaderForegroundHandoff(
  request: RitoReaderForegroundHandoff,
): Uint8Array;
export declare function decodeRitoReaderForegroundHandoffAck(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderForegroundHandoffAck;
