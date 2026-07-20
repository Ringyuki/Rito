import type {
  BrowserReaderWorkerClient,
  CoreSourceLocator,
  CoreRevisionHandle,
  CoreVersioned,
} from '../core-contracts';
import type { ReaderLocator, ReaderSourcePoint } from '../../../reader';
import { isCurrentRevisionHandle } from './pipeline/revision-handle';
import type { BrowserReaderRevisionHandle, BrowserReaderState } from './types';
import { browserReaderChapterLocalPreviewSuspendsInteractions } from '../chapter-local-preview/state';

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
  return readCapturedRevision(capture, read, () => captureIsCurrent(state, capture));
}

export async function readCapturedSource<T>(
  state: BrowserReaderState,
  capture: BrowserReaderInteractionCapture,
  read: (
    worker: BrowserReaderWorkerClient,
    revision: CoreRevisionHandle,
  ) => Promise<CoreVersioned<T>>,
): Promise<T | undefined> {
  return readCapturedRevision(capture, read, () => revisionCaptureIsCurrent(state, capture));
}

async function readCapturedRevision<T>(
  capture: BrowserReaderInteractionCapture,
  read: (
    worker: BrowserReaderWorkerClient,
    revision: CoreRevisionHandle,
  ) => Promise<CoreVersioned<T>>,
  isCurrent: () => boolean,
): Promise<T | undefined> {
  if (!isCurrent()) return undefined;
  let response: CoreVersioned<T>;
  try {
    response = await read(capture.worker, capture.coreRevision);
  } catch (error) {
    if (!isCurrent()) return undefined;
    throw error;
  }
  if (!isCurrent()) return undefined;
  if (!sameCoreRevision(response.revision, capture.coreRevision)) {
    throw new Error('Reader interaction response does not match its revision request');
  }
  return response.value;
}

export function captureInteraction(
  state: BrowserReaderState,
): BrowserReaderInteractionCapture | undefined {
  return captureCommittedSourceRead(state);
}

export function captureCommittedSourceRead(
  state: BrowserReaderState,
): BrowserReaderInteractionCapture | undefined {
  if (state.disposed || browserReaderChapterLocalPreviewSuspendsInteractions(state)) {
    return undefined;
  }
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
  return revisionCaptureIsCurrent(state, capture);
}

export function sameRevision(
  left: BrowserReaderRevisionHandle,
  right: BrowserReaderRevisionHandle,
  generation: 'commitGeneration' | 'publicationGeneration' = 'commitGeneration',
): boolean {
  return (
    sameCoreRevision(left, right) &&
    left.workerSessionId === right.workerSessionId &&
    left[generation] === right[generation]
  );
}

function sameCoreRevision(left: CoreRevisionHandle, right: CoreRevisionHandle): boolean {
  return left.revisionId === right.revisionId && left.revisionVersion === right.revisionVersion;
}
function revisionCaptureIsCurrent(
  state: BrowserReaderState,
  capture: BrowserReaderInteractionCapture,
): boolean {
  return (
    !state.disposed &&
    !browserReaderChapterLocalPreviewSuspendsInteractions(state) &&
    state.worker === capture.worker &&
    capture.worker.sessionId === capture.revision.workerSessionId &&
    isCurrentRevisionHandle(state, capture.revision)
  );
}
export function copyReaderLocator(locator: ReaderLocator | CoreSourceLocator): ReaderLocator {
  return {
    href: locator.href,
    ...(locator.anchorId !== undefined ? { anchorId: locator.anchorId } : {}),
    ...(locator.sourcePoint ? { sourcePoint: copyReaderSourcePoint(locator.sourcePoint) } : {}),
    ...(locator.sourceRange
      ? {
          sourceRange: {
            start: copyReaderSourcePoint(locator.sourceRange.start),
            end: copyReaderSourcePoint(locator.sourceRange.end),
          },
        }
      : {}),
    ...(locator.progression !== undefined ? { progression: locator.progression } : {}),
  };
}

export function copyReaderSourcePoint(point: ReaderSourcePoint): ReaderSourcePoint {
  return { nodePath: [...point.nodePath], textOffset: point.textOffset };
}
