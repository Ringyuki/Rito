import type { ReaderLocator } from '../../../../reader';
import type { CoreRevisionHandle } from '../../core-contracts';
import { copyReaderLocator } from '../source-locator';
import type {
  BrowserReaderQueuedReflow,
  BrowserReaderRevisionHandle,
  BrowserReaderState,
  BrowserReaderWorkerRevisionHandle,
} from '../types';
import { isCurrentRevisionHandle } from './revision-handle';
import { isStaleReflow } from './reflow-state';

export type BrowserReaderReflowAnchor =
  | {
      readonly status: 'captured';
      readonly activeSpreadIndex: number;
      readonly preserveLocator?: ReaderLocator | undefined;
    }
  | { readonly status: 'stale' };

export async function retryStaleReflow<T>(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  attempt: () => Promise<T | 'staleSpread'>,
): Promise<T | undefined> {
  while (!isStaleReflow(state, request)) {
    const result = await attempt();
    if (result !== 'staleSpread') return result;
  }
  return undefined;
}

interface ReflowAnchorCapture {
  readonly worker: BrowserReaderState['worker'];
  readonly revision: BrowserReaderRevisionHandle;
  readonly coreRevision: CoreRevisionHandle;
  readonly activeSpreadIndex: number;
  readonly pageIndexes: readonly number[];
}

export function captureBrowserReaderReflowAnchor(
  state: BrowserReaderState,
): BrowserReaderReflowAnchor | Promise<BrowserReaderReflowAnchor> {
  const capture = captureReflowAnchor(state);
  if (!capture) {
    return { status: 'captured', activeSpreadIndex: state.activeSpreadIndex };
  }
  return loadReflowAnchor(state, capture);
}

async function loadReflowAnchor(
  state: BrowserReaderState,
  capture: ReflowAnchorCapture,
): Promise<BrowserReaderReflowAnchor> {
  for (const pageIndex of capture.pageIndexes) {
    const result = await loadPageReflowAnchor(state, capture, pageIndex);
    if (result.status === 'stale' || result.preserveLocator) return result;
  }
  return { status: 'captured', activeSpreadIndex: capture.activeSpreadIndex };
}

async function loadPageReflowAnchor(
  state: BrowserReaderState,
  capture: ReflowAnchorCapture,
  pageIndex: number,
): Promise<BrowserReaderReflowAnchor> {
  let response: Awaited<ReturnType<typeof capture.worker.getPageReadingAnchorAtRevision>>;
  try {
    response = await capture.worker.getPageReadingAnchorAtRevision(capture.coreRevision, pageIndex);
  } catch (error) {
    if (!captureIsCurrent(state, capture)) return { status: 'stale' };
    throw error;
  }
  if (!captureIsCurrent(state, capture)) return { status: 'stale' };
  if (!sameCoreRevision(response.revision, capture.coreRevision)) {
    throw new Error('Reader reflow anchor response does not match its revision request');
  }
  const value = response.value;
  if (
    value.revisionId !== capture.coreRevision.revisionId ||
    value.pageIndex !== pageIndex ||
    value.spreadIndex !== capture.activeSpreadIndex
  ) {
    throw new Error('Reader reflow anchor response does not match its position request');
  }
  return value.status === 'resolved'
    ? {
        status: 'captured',
        activeSpreadIndex: capture.activeSpreadIndex,
        preserveLocator: copyReaderLocator(value.locator),
      }
    : { status: 'captured', activeSpreadIndex: capture.activeSpreadIndex };
}

function captureReflowAnchor(state: BrowserReaderState): ReflowAnchorCapture | undefined {
  if (state.disposed) return undefined;
  const revision = state.revisionHandle;
  const worker = state.worker;
  if (!revision || worker.sessionId !== revision.workerSessionId) return undefined;
  if (!isCurrentRevisionHandle(state, revision)) return undefined;
  const activeSpreadIndex = state.activeSpreadIndex;
  const spread = state.revisionBundle.navigation.spreads.find(
    (candidate) => candidate.spreadIndex === activeSpreadIndex,
  );
  if (!spread) return undefined;
  return {
    worker,
    revision,
    coreRevision: coreRevision(revision),
    activeSpreadIndex,
    pageIndexes: [...spread.pageIndexes],
  };
}

function captureIsCurrent(state: BrowserReaderState, capture: ReflowAnchorCapture): boolean {
  return (
    !state.disposed &&
    state.worker === capture.worker &&
    state.activeSpreadIndex === capture.activeSpreadIndex &&
    isCurrentRevisionHandle(state, capture.revision)
  );
}

function coreRevision(revision: BrowserReaderWorkerRevisionHandle): CoreRevisionHandle {
  return {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}

function sameCoreRevision(left: CoreRevisionHandle, right: CoreRevisionHandle): boolean {
  return left.revisionId === right.revisionId && left.revisionVersion === right.revisionVersion;
}
