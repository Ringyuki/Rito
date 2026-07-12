import type {
  BrowserReaderResourceBytes,
  BrowserReaderRevisionResult,
  BrowserReaderWorkerClient,
} from './core-contracts';
import { decodeBrowserReaderFrame } from './reader/frame';
import type {
  BrowserReaderFrame,
  BrowserReaderLocatorNavigation,
  BrowserReaderState,
} from './reader/types';
import { preloadFrameResourceBytes } from './resources';

export interface BrowserReaderPreparedCommitFrame {
  readonly displaySpreadIndex?: number | undefined;
  readonly frame?: BrowserReaderFrame | undefined;
  readonly resources?: readonly BrowserReaderResourceBytes[] | undefined;
}

export interface BrowserReaderPreparedViewCommitOptions {
  readonly visualPreview: boolean;
  readonly onCommitted: (() => void) | undefined;
  readonly baseCommitGeneration: number;
  readonly expectedLocatorNavigation: BrowserReaderLocatorNavigation | undefined;
  readonly rollbackFonts: () => void;
  readonly commitFrame: BrowserReaderPreparedCommitFrame;
}

export function requireBrowserReaderLocatorSelectedFrame(
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
  visualPreview: boolean,
): void {
  const selection = result.frameSelection;
  const selected = result.selectedFrame;
  if (
    !visualPreview &&
    !result.preview &&
    selection?.spreadIndex === selected?.spreadIndex &&
    selection?.displaySpreadIndex === selected?.displaySpreadIndex &&
    selected !== undefined &&
    selected.spreadIndex >= 0 &&
    selected.spreadIndex < result.bundle.revision.spreadCount
  ) {
    return;
  }
  void worker
    .releaseRevisionAtRevision({
      revisionId: result.bundle.revision.revisionId,
      revisionVersion: result.bundle.revision.revisionVersion,
    })
    .catch(() => undefined);
  throw new Error('Reader locator navigation full revision is missing a matching selected frame');
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
    void worker
      .releaseRevisionAtRevision({
        revisionId: result.bundle.revision.revisionId,
        revisionVersion: result.bundle.revision.revisionVersion,
      })
      .catch(() => undefined);
    throw error;
  }
}
