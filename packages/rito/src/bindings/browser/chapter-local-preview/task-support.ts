import type { BrowserReaderState } from '../reader/types';
import { closeBrowserReaderChapterLocalImages } from './frame';
import { sameBrowserReaderChapterLocalOwner } from './state';
import type {
  BrowserReaderChapterLocalOwner,
  BrowserReaderChapterLocalPreviewRequest,
} from './types';

export { closeBrowserReaderChapterLocalImages };

export async function releaseBrowserReaderChapterLocalOwner(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
  owner: BrowserReaderChapterLocalOwner,
): Promise<void> {
  if (state.disposed) return;
  try {
    const result = await request.transport.releaseChapterLocalRevision(owner);
    const releasedRevision: unknown = Reflect.get(result, 'releasedRevision');
    if (releasedRevision !== true || !sameBrowserReaderChapterLocalOwner(result.owner, owner)) {
      throw new Error('Reader chapter-local release did not confirm its exact owner');
    }
  } catch (error) {
    if (!isBrowserReaderDisposed(state)) {
      failClosedBrowserReaderChapterLocalSession(state, request, error);
    }
    throw error;
  }
}

function isBrowserReaderDisposed(state: BrowserReaderState): boolean {
  return state.disposed;
}

export function failClosedBrowserReaderChapterLocalSession(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest,
  error: unknown,
): void {
  const failure = error instanceof Error ? error : new Error(String(error));
  const current = state.boundedSessions.current;
  if (current?.worker.sessionId === request.workerSessionId) {
    current.terminalError = failure;
    state.boundedSessions.current = undefined;
    state.revisionHandle = undefined;
  }
  try {
    request.transport.disposeSession();
  } catch {
    // The exact-owner failure remains primary after best-effort containment.
  }
  try {
    state.logger.error('reader chapter-local ownership failed closed', failure);
  } catch {
    // Containment must not depend on a host logger.
  }
}
