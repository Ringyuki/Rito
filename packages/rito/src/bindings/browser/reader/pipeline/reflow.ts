import type { LayoutConfig, ReaderOptions } from '../../../../reader';
import { applyLayoutOverrides, makeBrowserReaderLayoutConfig, toCoreLayoutConfig } from '../layout';
import {
  activePreviewWorker,
  commitBrowserReaderViewResult,
  fullReflowWorker,
  visualConfigMatches,
} from '../revision';
import type { BrowserReaderQueuedReflow, BrowserReaderState } from '../types';
import type {
  CoreViewRevisionRequest,
  BrowserReaderViewRevisionResult,
  BrowserReaderWorkerClient,
} from '../../core-contracts';

type ResolvedViewRevision = Pick<BrowserReaderViewRevisionResult, 'kind' | 'followUp'>;

export function scheduleBrowserReaderReflow(
  state: BrowserReaderState,
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
  onCommitted?: () => void,
  force = false,
): boolean {
  const config = applyLayoutOverrides(state, makeBrowserReaderLayoutConfig(options, spreadMode));
  if (isNoOpReflow(state, config, spreadMode, lineBreaking, force)) return false;
  const request = { config, spreadMode, lineBreaking, onCommitted, token: ++state.reflow.token };
  if (state.revisionBundle.revision.revisionId.length === 0) {
    state.config = request.config;
    state.spreadMode = spreadMode;
    state.lineBreaking = lineBreaking;
  }
  state.reflow.queued = request;
  clearDeferredFullReflow(state);
  scheduleReflowDrain(state);
  return true;
}

export async function startBrowserReaderInitialReflow(
  state: BrowserReaderState,
  options: ReaderOptions,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
  onPreviewCommitted?: () => void,
  onFullCommitted?: () => void,
): Promise<void> {
  const config = applyLayoutOverrides(state, makeBrowserReaderLayoutConfig(options, spreadMode));
  state.config = config;
  state.spreadMode = spreadMode;
  state.lineBreaking = lineBreaking;
  if (state.revisionBundle.revision.revisionId.length > 0 || state.reflow.active) {
    scheduleBrowserReaderReflow(state, options, spreadMode, lineBreaking, onFullCommitted);
    return;
  }
  state.reflow.lastError = undefined;
  const request = {
    config,
    spreadMode,
    lineBreaking,
    token: ++state.reflow.token,
    onCommitted: onFullCommitted,
  };
  state.reflow.active = request;
  try {
    const resolved = await createAndCommitViewRevision(
      state,
      request,
      state.foregroundWorker,
      'preview',
      undefined,
      onPreviewCommitted,
    );
    if (resolved?.followUp && !state.disposed)
      scheduleDeferredFullReflow(state, request, resolved.followUp);
  } catch (error) {
    const wrapped = reportReflowError(state, error, 'initial reader reflow');
    if (state.revisionBundle.revision.revisionId.length === 0) throw wrapped;
  } finally {
    state.reflow.active = undefined;
    if (!state.disposed && state.reflow.queued) scheduleReflowDrain(state);
  }
}

export function clearDeferredFullReflow(state: BrowserReaderState): void {
  state.reflow.deferred = undefined;
  if (state.reflow.deferredTimer === undefined) return;
  clearTimeout(state.reflow.deferredTimer);
  state.reflow.deferredTimer = undefined;
}

async function drainReflowQueue(state: BrowserReaderState): Promise<void> {
  if (state.reflow.active) return;
  try {
    while (!state.disposed && state.reflow.queued) {
      const request = state.reflow.queued;
      state.reflow.queued = undefined;
      state.reflow.active = request;
      state.reflow.lastError = undefined;
      await createQueuedRevision(state, request);
    }
  } catch (error) {
    if (state.reflow.active?.token === state.reflow.token && !state.disposed)
      reportReflowError(state, error, 'queued reader reflow');
  } finally {
    state.reflow.active = undefined;
    if (!state.disposed && state.reflow.queued) scheduleReflowDrain(state);
  }
}

async function createQueuedRevision(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
): Promise<void> {
  const previousRevisionId = state.revisionBundle.revision.revisionId || undefined;
  if (previousRevisionId !== undefined) {
    const previewWorker = activePreviewWorker(state);
    const resolved = await createAndCommitViewRevision(
      state,
      request,
      previewWorker,
      'preview',
      previousRevisionId,
    );
    if (resolved?.followUp) {
      scheduleDeferredFullReflow(state, request, resolved.followUp);
      return;
    }
    if (resolved) return;
    if (request.token !== state.reflow.token || state.reflow.queued) return;
  }
  await createAndCommitFullRevision(state, request, 'full', previousRevisionId);
}

function scheduleDeferredFullReflow(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  followUp: NonNullable<BrowserReaderViewRevisionResult['followUp']>,
): void {
  clearDeferredFullReflow(state);
  state.reflow.deferred = { request, followUp };
  state.reflow.deferredTimer = setTimeout(() => {
    state.reflow.deferredTimer = undefined;
    const pending = state.reflow.deferred;
    if (!pending || pending.request !== request) return;
    if (state.disposed || state.reflow.active || state.reflow.queued) {
      clearDeferredFullReflow(state);
      return;
    }
    state.reflow.lastError = undefined;
    void createAndCommitFullRevision(state, pending.request, pending.followUp.request)
      .catch((error: unknown) => {
        if (pending.request.token === state.reflow.token && !state.disposed)
          reportReflowError(state, error, 'deferred full reader reflow');
      })
      .finally(() => {
        if (state.reflow.deferred === pending) state.reflow.deferred = undefined;
        if (!state.disposed && state.reflow.queued) scheduleReflowDrain(state);
      });
  }, followUp.delayMs);
}

async function createAndCommitFullRevision(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  workerRequest: CoreViewRevisionRequest | 'full',
  previousRevisionId?: string,
): Promise<void> {
  const worker = await fullReflowWorker(state);
  if (state.disposed || request.token !== state.reflow.token) return;
  const previousId = state.worker === worker ? previousRevisionId : undefined;
  if (typeof workerRequest !== 'string' && state.worker !== worker) {
    const { previousRevisionId: _previousRevisionId, ...crossWorkerRequest } = workerRequest;
    workerRequest = crossWorkerRequest;
  }
  await createAndCommitViewRevision(state, request, worker, workerRequest, previousId);
}
async function createAndCommitViewRevision(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  workerRequest: CoreViewRevisionRequest | 'preview' | 'full',
  previousRevisionId: string | undefined,
  onPreviewCommitted?: () => void,
): Promise<ResolvedViewRevision | undefined> {
  const dispatchRequest =
    typeof workerRequest === 'string'
      ? {
          layoutConfig: toCoreLayoutConfig(request.config),
          lineBreaking: request.lineBreaking,
          activeSpreadIndex: state.activeSpreadIndex,
          mode: workerRequest,
          ...(previousRevisionId !== undefined ? { previousRevisionId } : {}),
        }
      : workerRequest;
  const view = await worker.createViewRevision({
    ...dispatchRequest,
    activeSpreadIndex: state.activeSpreadIndex,
  });
  const visualPreview = view.display === 'visualPreview';
  const onCommitted = view.kind === 'full' ? request.onCommitted : onPreviewCommitted;
  const commit = await commitBrowserReaderViewResult(
    state,
    request,
    worker,
    view.result,
    visualPreview,
    visualPreview ? undefined : onCommitted,
  );
  if (commit === 'staleSpread')
    return view.followUp ? { kind: view.kind, followUp: view.followUp } : undefined;
  return commit ? { kind: view.kind, followUp: view.followUp } : undefined;
}

function scheduleReflowDrain(state: BrowserReaderState): void {
  if (state.disposed || state.reflow.active) return;
  if (state.revisionBundle.revision.revisionId.length === 0) void drainReflowQueue(state);
  else scheduleMicrotask(state, () => void drainReflowQueue(state));
}

function isNoOpReflow(
  state: BrowserReaderState,
  config: LayoutConfig,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
  force: boolean,
): boolean {
  if (
    force ||
    (!state.revisionBundle.revision.revisionId &&
      !state.reflow.active &&
      state.reflow.queued === undefined &&
      state.reflow.deferred === undefined)
  )
    return false;
  const pending = state.reflow.queued ?? state.reflow.active ?? state.reflow.deferred?.request;
  if (pending) return reflowRequestEqual(pending, config, spreadMode, lineBreaking);
  if (state.visualPreview) return visualConfigMatches(state, config, spreadMode, lineBreaking);
  return (
    layoutConfigEqual(state.config, config) &&
    state.spreadMode === spreadMode &&
    state.lineBreaking === lineBreaking
  );
}

function reflowRequestEqual(
  request: BrowserReaderQueuedReflow,
  config: LayoutConfig,
  spreadMode: 'single' | 'double',
  lineBreaking: 'greedy' | 'optimal',
): boolean {
  return (
    layoutConfigEqual(request.config, config) &&
    request.spreadMode === spreadMode &&
    request.lineBreaking === lineBreaking
  );
}

function layoutConfigEqual(a: LayoutConfig, b: LayoutConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function scheduleMicrotask(state: BrowserReaderState, task: () => void): void {
  if (state.reflow.microtaskScheduled) return;
  state.reflow.microtaskScheduled = true;
  const run = (): void => {
    state.reflow.microtaskScheduled = false;
    task();
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(run);
  else void Promise.resolve().then(run);
}

function reportReflowError(state: BrowserReaderState, error: unknown, label: string): Error {
  const wrapped =
    error instanceof Error
      ? new Error(`${label} failed`, { cause: error })
      : new Error(`${label} failed`);
  state.reflow.lastError = wrapped;
  state.logger.error(`${label} failed`, wrapped);
  return wrapped;
}
