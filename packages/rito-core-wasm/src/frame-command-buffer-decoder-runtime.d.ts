import type { DecodedRitoFrameCommandBuffer, RitoFrameCommandBufferMetadata } from './types';

export declare const decodeRitoFrameCommandBuffer: (
  metadata: RitoFrameCommandBufferMetadata,
  bytes: Uint8Array,
) => DecodedRitoFrameCommandBuffer;
