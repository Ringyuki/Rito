import type {
  RitoReaderAdjacentRequest,
  RitoReaderArtifactRequest,
  RitoReaderSpreadRequest,
} from './types';

export declare function encodeRitoReaderArtifactRequest(
  request: RitoReaderArtifactRequest,
): Uint8Array;
export declare function encodeRitoReaderAdjacentRequest(
  request: RitoReaderAdjacentRequest,
): Uint8Array;
export declare function encodeRitoReaderSpreadRequest(request: RitoReaderSpreadRequest): Uint8Array;
