import type { BrowserReaderFrameBuffer } from './core-contracts';
import type { BrowserReaderFrame, BrowserReaderState } from './reader/types';

export function decodeBrowserReaderFrame(
  decodeFrameCommandBuffer: BrowserReaderState['decodeFrameCommandBuffer'],
  revisionId: string,
  spreadIndex: number,
  buffer: BrowserReaderFrameBuffer,
): BrowserReaderFrame {
  assertFrameBufferMatchesRequest(buffer, revisionId, spreadIndex);
  const decoded = decodeFrameCommandBuffer(buffer.metadata, buffer.bytes);
  return {
    revisionId,
    spreadIndex,
    width: buffer.metadata.width,
    height: buffer.metadata.height,
    commands: decoded.commands,
    commandHash: buffer.metadata.commandHash,
    resourceRefs: { images: buffer.metadata.resourceTable },
    fontFamilies: buffer.metadata.fontFamilies,
    imageDominated: buffer.metadata.imageDominated,
  };
}

function assertFrameBufferMatchesRequest(
  buffer: BrowserReaderFrameBuffer,
  revisionId: string,
  spreadIndex: number,
): void {
  if (buffer.metadata.revisionId !== revisionId) {
    throw new Error(
      `Reader frame buffer revision mismatch: expected ${revisionId}, got ${buffer.metadata.revisionId}`,
    );
  }
  if (buffer.metadata.spreadIndex !== spreadIndex) {
    throw new Error(
      `Reader frame buffer spread mismatch: expected ${String(spreadIndex)}, got ${String(buffer.metadata.spreadIndex)}`,
    );
  }
}
