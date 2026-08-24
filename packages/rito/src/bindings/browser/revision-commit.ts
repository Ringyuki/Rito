import type { BrowserReaderResourceBytes, BrowserReaderRevisionResult } from './core-contracts';
import { preloadFrameResourceBytes } from './resources';
import { decodeBrowserReaderFrame } from './reader/frame';
import type { BrowserReaderFrame, BrowserReaderState } from './reader/types';

export interface BrowserReaderPreparedCommitFrame {
  readonly frame?: BrowserReaderFrame | undefined;
}

export async function prepareControllerOwnedBrowserReaderCommitFrame(
  state: BrowserReaderState,
  result: BrowserReaderRevisionResult,
  superseded?: Promise<void>,
): Promise<BrowserReaderPreparedCommitFrame | undefined> {
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
  if (frame.imageDominated) {
    // A superseded append still has to publish its already-advanced revision,
    // but it must not keep the next locator waiting on non-critical decoding.
    await prepareBrowserReaderCommitResources(state, resources, superseded);
  }
  return { frame };
}

export async function prepareBrowserReaderCommitResources(
  state: BrowserReaderState,
  resources: readonly BrowserReaderResourceBytes[] | undefined,
  superseded?: Promise<void>,
): Promise<boolean> {
  if (!resources) return true;
  const preload = preloadFrameResourceBytes(state, resources);
  if (!superseded) {
    await preload;
    return true;
  }
  return Promise.race([preload.then(() => true), superseded.then(() => false)]);
}
