import type {
  BrowserReaderResourceBytes,
  BrowserReaderRevisionResult,
  BrowserReaderWorkerClient,
} from './core-contracts';
import { decodeBrowserReaderFrame } from './reader/frame';
import type { BrowserReaderFrame, BrowserReaderState } from './reader/types';
import { preloadFrameResourceBytes } from './resources';

export interface BrowserReaderPreparedCommitFrame {
  readonly displaySpreadIndex?: number | undefined;
  readonly frame?: BrowserReaderFrame | undefined;
  readonly resources?: readonly BrowserReaderResourceBytes[] | undefined;
}

export async function prepareBrowserReaderCommitFrame(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
  onFailure?: () => void,
): Promise<BrowserReaderPreparedCommitFrame> {
  try {
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
    return { displaySpreadIndex: selection.displaySpreadIndex, frame, resources };
  } catch (error) {
    onFailure?.();
    void worker.releaseRevision(result.bundle.revision.revisionId).catch(() => undefined);
    throw error;
  }
}
