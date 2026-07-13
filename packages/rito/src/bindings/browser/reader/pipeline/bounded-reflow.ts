import type { ReaderOptions } from '../../../../reader';
import {
  createBrowserReaderBoundedSessionOwner,
  startBrowserReaderBoundedCandidate,
} from '../../bounded-session-runtime';
import { openBrowserReaderWorker } from '../../pinned-fonts';
import { applyLayoutOverrides, makeBrowserReaderLayoutConfig } from '../layout';
import type { BrowserReaderQueuedReflow, BrowserReaderState } from '../types';
import { captureBrowserReaderReflowAnchor } from './reflow-anchor';
import {
  isNoOpReflow,
  isStaleReflow,
  reportReflowError,
  scheduleReaderMicrotask,
} from './reflow-state';

type State = BrowserReaderState;
type Request = BrowserReaderQueuedReflow;
type CandidateResult = 'committed' | 'retry' | 'cancelled';

const activeAborts = new WeakMap<State, AbortController>();

export function scheduleBrowserReaderReflow(
  state: State,
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
  onCommitted?: () => void,
  force = false,
): boolean {
  const config = applyLayoutOverrides(state, makeBrowserReaderLayoutConfig(options, spreadMode));
  if (isNoOpReflow(state, config, spreadMode, lineBreaking, force)) return false;
  const request: Request = {
    config,
    spreadMode,
    lineBreaking,
    onCommitted,
    token: ++state.reflow.token,
  };
  state.reflow.queued = request;
  activeAborts.get(state)?.abort();
  scheduleReflowDrain(state);
  return true;
}

export async function startBrowserReaderInitialReflow(
  state: State,
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
  onCommitted?: () => void,
): Promise<void> {
  let request: Request;
  let owner: ReturnType<typeof createBrowserReaderBoundedSessionOwner>;
  try {
    if (state.boundedSessions.current || state.revisionBundle.revision.revisionId.length > 0) {
      throw new Error('Browser reader initial bounded reflow requires an empty session');
    }
    request = initialRequest(state, options, spreadMode, lineBreaking, onCommitted);
    owner = createBrowserReaderBoundedSessionOwner(state.worker);
  } catch (error) {
    state.worker.dispose();
    throw reportReflowError(state, error, 'initial reader reflow');
  }
  const abort = new AbortController();
  state.reflow.active = request;
  activeAborts.set(state, abort);
  try {
    const snapshot = await startBrowserReaderBoundedCandidate(
      state,
      owner,
      {
        config: request.config,
        spreadMode,
        lineBreaking,
        targetSpreadIndex: 0,
        onCommitted,
      },
      abort.signal,
    );
    if (!snapshot) throw new Error('Initial bounded reader candidate was cancelled');
  } catch (error) {
    throw reportReflowError(state, error, 'initial reader reflow');
  } finally {
    finishActiveRequest(state, request, abort);
  }
}

export function cancelBrowserReaderReflow(state: State): void {
  state.reflow.token += 1;
  state.reflow.queued = undefined;
  activeAborts.get(state)?.abort();
  activeAborts.delete(state);
}

function initialRequest(
  state: State,
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
  onCommitted: (() => void) | undefined,
): Request {
  const request = {
    config: applyLayoutOverrides(state, makeBrowserReaderLayoutConfig(options, spreadMode)),
    spreadMode,
    lineBreaking,
    onCommitted,
    token: ++state.reflow.token,
  };
  state.config = request.config;
  state.spreadMode = spreadMode;
  state.lineBreaking = lineBreaking;
  state.reflow.lastError = undefined;
  return request;
}

async function drainReflowQueue(state: State): Promise<void> {
  if (state.reflow.active) return;
  while (!state.disposed && state.reflow.queued) {
    const request = state.reflow.queued;
    state.reflow.queued = undefined;
    state.reflow.active = request;
    state.reflow.lastError = undefined;
    const abort = new AbortController();
    activeAborts.set(state, abort);
    try {
      await runQueuedRequest(state, request, abort.signal);
    } catch (error) {
      if (!isStaleReflow(state, request) && !abort.signal.aborted) {
        reportReflowError(state, error, 'queued reader reflow');
      }
    } finally {
      finishActiveRequest(state, request, abort);
    }
  }
}

async function runQueuedRequest(
  state: State,
  request: Request,
  signal: AbortSignal,
): Promise<void> {
  while (!isStaleReflow(state, request) && !signal.aborted) {
    const result = await createBoundedCandidate(state, request, signal);
    if (result !== 'retry') return;
  }
}

async function createBoundedCandidate(
  state: State,
  request: Request,
  signal: AbortSignal,
): Promise<CandidateResult> {
  const worker = state.workerFactory();
  if (worker.sessionId === state.worker.sessionId) {
    throw new Error('Browser reader reflow candidate requires an independent worker session');
  }
  let ownerCreated = false;
  try {
    await openBrowserReaderWorker(
      worker,
      state.documentData.slice(0),
      state.pinnedFonts.policy,
      state.pinnedFonts.summary,
    );
    if (!requestIsLive(state, request, signal)) return 'cancelled';
    await waitForExactReads(state, request, signal);
    if (!requestIsLive(state, request, signal)) return 'cancelled';
    const anchor = await captureBrowserReaderReflowAnchor(state);
    if (anchor.status === 'stale') return 'retry';
    if (anchor.status === 'superseded') return 'cancelled';
    const owner = createBrowserReaderBoundedSessionOwner(worker);
    ownerCreated = true;
    const snapshot = await startBrowserReaderBoundedCandidate(
      state,
      owner,
      {
        config: request.config,
        spreadMode: request.spreadMode,
        lineBreaking: request.lineBreaking,
        targetSpreadIndex: anchor.activeSpreadIndex,
        expectedActiveSpreadIndex: anchor.activeSpreadIndex,
        onCommitted: request.onCommitted,
        ...(anchor.preserveLocator ? { preserveLocator: anchor.preserveLocator } : {}),
      },
      signal,
    );
    if (snapshot) return 'committed';
    return requestIsLive(state, request, signal) ? 'retry' : 'cancelled';
  } finally {
    if (!ownerCreated) worker.dispose();
  }
}

async function waitForExactReads(
  state: State,
  request: Request,
  signal: AbortSignal,
): Promise<void> {
  const owner = state.boundedSessions.current;
  while (
    owner?.readsSuspended &&
    state.boundedSessions.current === owner &&
    !isStaleReflow(state, request) &&
    !signal.aborted
  ) {
    await nextTask();
  }
  if (!isStaleReflow(state, request) && !signal.aborted && !state.boundedSessions.current) {
    throw new Error('Browser reader lost its current bounded session during reflow');
  }
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function requestIsLive(state: State, request: Request, signal: AbortSignal): boolean {
  return !isStaleReflow(state, request) && !signal.aborted;
}

function finishActiveRequest(state: State, request: Request, abort: AbortController): void {
  if (activeAborts.get(state) === abort) activeAborts.delete(state);
  if (state.reflow.active === request) state.reflow.active = undefined;
  if (!state.disposed && state.reflow.queued) scheduleReflowDrain(state);
}

function scheduleReflowDrain(state: State): void {
  if (state.disposed || state.reflow.active) return;
  scheduleReaderMicrotask(state, () => void drainReflowQueue(state));
}
