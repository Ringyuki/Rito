import type { RitoReaderPrimitiveList } from './types';

export declare const READER_V1_PRIMITIVE_LIST_FORMAT_VERSION: 2;

export declare function decodeRitoReaderPrimitiveList(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderPrimitiveList;
