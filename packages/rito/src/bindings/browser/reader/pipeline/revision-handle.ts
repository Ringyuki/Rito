import type { BrowserReaderWorkerClient } from '../../core-contracts';
import type {
  BrowserReaderRevisionHandle,
  BrowserReaderState,
  BrowserReaderWorkerRevisionHandle,
} from '../types';

export function createWorkerRevisionHandle(
  worker: BrowserReaderWorkerClient,
  revisionId: string,
): BrowserReaderWorkerRevisionHandle {
  return { workerSessionId: worker.sessionId, revisionId, revisionVersion: 0 };
}

export function commitRevisionHandle(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  revisionId: string,
): BrowserReaderRevisionHandle {
  state.commitGeneration += 1;
  return {
    ...createWorkerRevisionHandle(worker, revisionId),
    commitGeneration: state.commitGeneration,
  };
}

export function isCurrentRevisionHandle(
  state: BrowserReaderState,
  handle: BrowserReaderRevisionHandle,
): boolean {
  const current = state.revisionHandle;
  return (
    current !== undefined &&
    state.worker.sessionId === handle.workerSessionId &&
    current.workerSessionId === handle.workerSessionId &&
    current.revisionId === handle.revisionId &&
    current.revisionVersion === handle.revisionVersion &&
    current.commitGeneration === handle.commitGeneration
  );
}

export function currentCommitGeneration(state: BrowserReaderState): number {
  return state.revisionHandle?.commitGeneration ?? 0;
}
