import type { RitoReaderArtifact, RitoReaderPageRecords, RitoReaderResource } from './types';

export declare function decodeRitoReaderArtifact(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderArtifact;
export declare function decodeRitoReaderPageRecords(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderPageRecords;
export declare function decodeRitoReaderResource(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderResource;
