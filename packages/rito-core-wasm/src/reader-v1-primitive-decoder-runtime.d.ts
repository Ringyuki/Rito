import type { RitoReaderPrimitiveListV1 } from './types';

export declare const READER_V1_PRIMITIVE_LIST_FORMAT_VERSION: 2;

export declare function decodeRitoReaderPrimitiveListV1(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderPrimitiveListV1;
