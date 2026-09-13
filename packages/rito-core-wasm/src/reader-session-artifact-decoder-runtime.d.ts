import type { RitoReaderArtifact, RitoReaderResource } from './types';

export declare function decodeRitoReaderArtifact(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderArtifact;
export declare function decodeRitoReaderResource(
  bytes: ArrayBuffer | Uint8Array,
): RitoReaderResource;
