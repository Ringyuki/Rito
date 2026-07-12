import type { BrowserReaderWorkerClient } from '../../core-contracts';
import type {
  BrowserReaderRevisionHandle,
  BrowserReaderState,
  BrowserReaderWorkerRevisionHandle,
} from '../types';

export function createWorkerRevisionHandle(
  worker: BrowserReaderWorkerClient,
  revisionId: string,
  revisionVersion: number,
): BrowserReaderWorkerRevisionHandle {
  return { workerSessionId: worker.sessionId, revisionId, revisionVersion };
}

export function commitRevisionHandle(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  revisionId: string,
  revisionVersion: number,
): BrowserReaderRevisionHandle {
  state.commitGeneration += 1;
  return {
    ...createWorkerRevisionHandle(worker, revisionId, revisionVersion),
    commitGeneration: state.commitGeneration,
  };
}

export function isCurrentRevisionHandle(
  state: BrowserReaderState,
  handle: BrowserReaderRevisionHandle,
): boolean {
  const current = state.revisionHandle;
  return (
    !state.disposed &&
    current !== undefined &&
    state.worker.sessionId === handle.workerSessionId &&
    current.workerSessionId === handle.workerSessionId &&
    current.revisionId === handle.revisionId &&
    current.revisionVersion === handle.revisionVersion &&
    current.commitGeneration === handle.commitGeneration
  );
}

export function closeExactRevisionReadGate(state: BrowserReaderState): void {
  if (!state.revisionHandle) return;
  state.commitGeneration += 1;
  state.revisionHandle = undefined;
}

export function currentCommitGeneration(state: BrowserReaderState): number {
  return state.commitGeneration;
}
