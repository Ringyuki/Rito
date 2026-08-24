import type { BrowserReaderWorkerClient } from '../core-contracts';
import type {
  BrowserReaderChapterLocalCapableWorker,
  BrowserReaderChapterLocalTransport,
} from './types';

const PREVIEW_GATE = Symbol.for('@ritojs/core/browser/chapter-local-preview');

type PreviewGateHost = typeof globalThis & { [PREVIEW_GATE]?: boolean };

/** Internal rollout gate. Tests/E2E may set the global symbol without expanding ReaderOptions. */
export function browserReaderChapterLocalPreviewEnabled(): boolean {
  return (globalThis as PreviewGateHost)[PREVIEW_GATE] !== false;
}

export function browserReaderChapterLocalTransport(
  worker: BrowserReaderWorkerClient,
): BrowserReaderChapterLocalTransport | undefined {
  if (!browserReaderChapterLocalPreviewEnabled() || !isCapableWorker(worker)) return undefined;
  return {
    workerSessionId: worker.sessionId,
    disposeSession: () => {
      worker.dispose();
    },
    createBoundedChapterLocalRevision: (request) =>
      worker.createBoundedChapterLocalRevision(request),
    continueChapterLocalRevision: (request) => worker.continueChapterLocalRevision(request),
    releaseChapterLocalRevision: (owner) => worker.releaseChapterLocalRevision(owner),
  };
}

function isCapableWorker(
  worker: BrowserReaderWorkerClient,
): worker is BrowserReaderChapterLocalCapableWorker {
  const candidate = worker as Partial<BrowserReaderChapterLocalCapableWorker>;
  return (
    typeof candidate.createBoundedChapterLocalRevision === 'function' &&
    typeof candidate.continueChapterLocalRevision === 'function' &&
    typeof candidate.releaseChapterLocalRevision === 'function'
  );
}
