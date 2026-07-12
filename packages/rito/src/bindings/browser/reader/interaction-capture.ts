import type {
  BrowserReaderWorkerClient,
  CoreRevisionHandle,
  CoreVersioned,
} from '../core-contracts';
import { isCurrentRevisionHandle } from './pipeline/revision-handle';
import type { BrowserReaderRevisionHandle, BrowserReaderState } from './types';

export interface BrowserReaderInteractionCapture {
  readonly worker: BrowserReaderWorkerClient;
  readonly revision: BrowserReaderRevisionHandle;
  readonly coreRevision: CoreRevisionHandle;
}

export async function readCapturedInteraction<T>(
  state: BrowserReaderState,
  capture: BrowserReaderInteractionCapture,
  read: (
    worker: BrowserReaderWorkerClient,
    revision: CoreRevisionHandle,
  ) => Promise<CoreVersioned<T>>,
): Promise<T | undefined> {
  if (!captureIsCurrent(state, capture)) return undefined;
  let response: CoreVersioned<T>;
  try {
    response = await read(capture.worker, capture.coreRevision);
  } catch (error) {
    if (!captureIsCurrent(state, capture)) return undefined;
    throw error;
  }
  if (!captureIsCurrent(state, capture)) return undefined;
  if (!sameCoreRevision(response.revision, capture.coreRevision)) {
    throw new Error('Reader interaction response does not match its revision request');
  }
  return response.value;
}

export function captureInteraction(
  state: BrowserReaderState,
): BrowserReaderInteractionCapture | undefined {
  if (state.disposed || state.visualPreview) return undefined;
  const revision = state.revisionHandle;
  const worker = state.worker;
  if (!revision || worker.sessionId !== revision.workerSessionId) return undefined;
  if (!isCurrentRevisionHandle(state, revision)) return undefined;
  return {
    worker,
    revision,
    coreRevision: {
      revisionId: revision.revisionId,
      revisionVersion: revision.revisionVersion,
    },
  };
}

export function captureIsCurrent(
  state: BrowserReaderState,
  capture: BrowserReaderInteractionCapture,
): boolean {
  return (
    !state.disposed &&
    state.visualPreview === undefined &&
    state.worker === capture.worker &&
    capture.worker.sessionId === capture.revision.workerSessionId &&
    isCurrentRevisionHandle(state, capture.revision)
  );
}

export function sameRevision(
  left: BrowserReaderRevisionHandle,
  right: BrowserReaderRevisionHandle,
): boolean {
  return (
    left.workerSessionId === right.workerSessionId &&
    left.revisionId === right.revisionId &&
    left.revisionVersion === right.revisionVersion &&
    left.commitGeneration === right.commitGeneration
  );
}

function sameCoreRevision(left: CoreRevisionHandle, right: CoreRevisionHandle): boolean {
  return left.revisionId === right.revisionId && left.revisionVersion === right.revisionVersion;
}
