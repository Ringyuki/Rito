import type { BrowserReaderRevisionResult, BrowserReaderWorkerClient } from './core-contracts';
import { resetFrameCache } from './reader/frame-cache';
import type { BrowserReaderFrame, BrowserReaderState } from './reader/types';

interface PreparedBrowserReaderFrameCache {
  readonly frameCachePrepared: boolean;
  readonly initialFrame: BrowserReaderFrame | undefined;
}

export function prepareBrowserReaderBoundedFrameCache(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
  initialFrame: BrowserReaderFrame | undefined,
): PreparedBrowserReaderFrameCache {
  const previous = state.revisionBundle.revision;
  const next = result.bundle.revision;
  const preserve =
    previous.revisionId.length > 0 &&
    state.worker.sessionId === worker.sessionId &&
    previous.revisionId === next.revisionId &&
    next.revisionVersion > previous.revisionVersion;
  if (preserve) resetFrameCache(state, true);
  return {
    frameCachePrepared: preserve,
    initialFrame:
      preserve && initialFrame && state.frames.has(initialFrame.spreadIndex)
        ? undefined
        : initialFrame,
  };
}
