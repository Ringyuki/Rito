import type { BrowserReaderRevisionResult } from './core-contracts';
import { preloadFrameResourceBytes } from './resources';
import { decodeBrowserReaderFrame } from './reader/frame';
import type { BrowserReaderFrame, BrowserReaderState } from './reader/types';

export interface BrowserReaderPreparedCommitFrame {
  readonly frame?: BrowserReaderFrame | undefined;
}

export async function prepareControllerOwnedBrowserReaderCommitFrame(
  state: BrowserReaderState,
  result: BrowserReaderRevisionResult,
): Promise<BrowserReaderPreparedCommitFrame> {
  const selection = result.selectedFrame;
  if (!selection || selection.spreadIndex >= result.bundle.revision.spreadCount) return {};
  const frame = decodeBrowserReaderFrame(
    state.decodeFrameCommandBuffer,
    result.bundle.revision.revisionId,
    selection.spreadIndex,
    selection.frame,
  );
  const resources = result.frameWindow?.spreads.find(
    (spread) => spread.spreadIndex === selection.spreadIndex,
  )?.resources;
  if (frame.imageDominated && resources) await preloadFrameResourceBytes(state, resources);
  return { frame };
}
