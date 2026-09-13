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
    createChapterLocalRevision: (request) => worker.createChapterLocalRevision(request),
    releaseChapterLocalRevision: (owner) => worker.releaseChapterLocalRevision(owner),
  };
}

function isCapableWorker(
  worker: BrowserReaderWorkerClient,
): worker is BrowserReaderChapterLocalCapableWorker {
  const candidate = worker as Partial<BrowserReaderChapterLocalCapableWorker>;
  return (
    typeof candidate.createChapterLocalRevision === 'function' &&
    typeof candidate.releaseChapterLocalRevision === 'function'
  );
}
