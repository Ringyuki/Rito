import type { ReaderLocator, ReaderOptions } from '../../../../reader';
import {
  createBrowserReaderBoundedSessionOwner,
  reclaimBrowserReaderStalledSession,
  startBrowserReaderBoundedCandidate,
} from '../../bounded-session-runtime';
import { openBrowserReaderWorker } from '../../pinned-fonts';
import { applyLayoutOverrides, makeBrowserReaderLayoutConfig } from '../../reader-layout';
import type { BrowserReaderQueuedReflow, BrowserReaderState } from '../types';
import { trackBrowserReaderHostTask } from '../host-tasks';
import { createBrowserReaderFontGeometryRetryGuard } from '../../bounded-font-geometry';
import { captureBrowserReaderReflowAnchor } from './reflow-anchor';
import { copyReaderLocator } from '../interaction-capture';
import {
  isNoOpReflow,
  isStaleReflow,
  reportReflowError,
  scheduleReaderMicrotask,
} from './reflow-state';
import { supersedeBrowserReaderChapterLocalPreview } from '../../chapter-local-preview/coordinator';
import { yieldBrowserHostTask } from '../../host-yield';

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
  if (state.disposed) return false;
  const config = applyLayoutOverrides(state, makeBrowserReaderLayoutConfig(options, spreadMode));
  if (isNoOpReflow(state, config, spreadMode, lineBreaking, force)) return false;
  supersedeBrowserReaderChapterLocalPreview(state);
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
    await runInitialCandidateLoop(
      state,
      request,
      owner,
      spreadMode,
      lineBreaking,
      onCommitted,
      options.initialLocator ? copyReaderLocator(options.initialLocator) : undefined,
      abort.signal,
    );
  } catch (error) {
    throw reportReflowError(state, error, 'initial reader reflow');
  } finally {
    finishActiveRequest(state, request, abort);
  }
}

async function runInitialCandidateLoop(
  state: State,
  request: Request,
  initialOwner: ReturnType<typeof createBrowserReaderBoundedSessionOwner>,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
  onCommitted: (() => void) | undefined,
  initialLocator: ReaderLocator | undefined,
  signal: AbortSignal,
): Promise<void> {
  let owner = initialOwner;
  const canRetryFontGeometry = createBrowserReaderFontGeometryRetryGuard(state);
  for (;;) {
    const snapshot = await startBrowserReaderBoundedCandidate(
      state,
      owner,
      {
        config: request.config,
        spreadMode,
        lineBreaking,
        targetSpreadIndex: 0,
        onCommitted,
        ...(initialLocator
          ? { preserveLocator: initialLocator, fallbackOnLocatorFailure: true }
          : {}),
      },
      signal,
    );
    if (snapshot) return;
    if (state.disposed || signal.aborted || !canRetryFontGeometry()) {
      throw new Error('Initial bounded reader candidate was cancelled');
    }
    const worker = state.workerFactory();
    try {
      await openBrowserReaderWorker(
        worker,
        state.documentData.slice(0),
        state.pinnedFonts.policy,
        state.pinnedFonts.summary,
        state.fragmentPagination,
      );
      owner = createBrowserReaderBoundedSessionOwner(worker);
    } catch (error) {
      worker.dispose();
      throw error;
    }
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
      state.fragmentPagination,
    );
    if (!requestIsLive(state, request, signal)) return 'cancelled';
    await waitForExactReads(state, request, signal);
    if (!requestIsLive(state, request, signal)) return 'cancelled';
    const anchor = await captureBrowserReaderReflowAnchor(state);
    if (anchor.status === 'stale') return 'retry';
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
        // Evaluated at COMMIT time, not capture time: if the reader
        // navigated while this candidate laid out, the user's live
        // spread wins over the request-time anchor (a whole-book
        // candidate can take seconds; landing its stale anchor yanked
        // the reader back one spread — measured on rapid keyboard turns
        // during pagination). When the reader stayed put, the anchor
        // resolution applies as before, so a genuine remap (config
        // change shifting page boundaries) still repositions.
        preserveActiveSpread: () => state.activeSpreadIndex !== anchor.activeSpreadIndex,
      },
      signal,
    );
    if (snapshot) return 'committed';
    return requestIsLive(state, request, signal) ? 'retry' : 'cancelled';
  } finally {
    if (!ownerCreated) worker.dispose();
  }
}

/// A suspended gate is reopened by whichever operation suspended it, so this
/// wait depends on progress it cannot make itself. Bound it: a gate that never
/// reopens is a defect somewhere upstream, and surfacing it as an error keeps
/// a reader interaction from stalling with no explanation.
const EXACT_READ_WAIT_LIMIT_MS = 5_000;

async function waitForExactReads(
  state: State,
  request: Request,
  signal: AbortSignal,
): Promise<void> {
  const owner = state.boundedSessions.current;
  const deadline = nowMilliseconds() + EXACT_READ_WAIT_LIMIT_MS;
  while (
    owner?.readsSuspended &&
    state.boundedSessions.current === owner &&
    !isStaleReflow(state, request) &&
    !signal.aborted
  ) {
    if (nowMilliseconds() >= deadline) {
      // The session that holds the gate is not going to reopen it. Retire it
      // so this reflow can rebuild from a fresh session instead of waiting
      // out an interaction the reader can never finish.
      await reclaimBrowserReaderStalledSession(state, owner);
      break;
    }
    await yieldBrowserHostTask();
  }
  // A reflow builds its own candidate session, so a missing current session is
  // not a failure here: it just means there are no in-flight exact reads to
  // drain. The anchor capture falls back to the last active spread.
}

function nowMilliseconds(): number {
  return typeof performance === 'object' ? performance.now() : Date.now();
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
  scheduleReaderMicrotask(state, () => {
    if (state.disposed) return;
    void trackBrowserReaderHostTask(state, drainReflowQueue(state));
  });
}
