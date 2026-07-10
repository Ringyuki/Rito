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
  BrowserReaderViewRevisionResult,
  BrowserReaderWorkerClient,
} from '../../core-contracts';

type CommittedViewRevision = Pick<BrowserReaderViewRevisionResult, 'kind' | 'followUp'>;

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
  state.reflow.active = true;
  state.reflow.lastError = undefined;
  const request = {
    config,
    spreadMode,
    lineBreaking,
    token: ++state.reflow.token,
    onCommitted: onFullCommitted,
  };
  try {
    const committed = await createAndCommitViewRevision(
      state,
      request,
      state.foregroundWorker,
      'preview',
      undefined,
      onPreviewCommitted,
    );
    if (committed?.followUp && !state.disposed)
      scheduleDeferredFullReflow(state, request, committed.followUp);
  } catch (error) {
    const wrapped = reportReflowError(state, error, 'initial reader reflow');
    if (state.revisionBundle.revision.revisionId.length === 0) throw wrapped;
  } finally {
    state.reflow.active = false;
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
  state.reflow.active = true;
  try {
    while (!state.disposed && state.reflow.queued) {
      const request = state.reflow.queued;
      state.reflow.queued = undefined;
      state.reflow.lastError = undefined;
      await createQueuedRevision(state, request);
    }
  } catch (error) {
    reportReflowError(state, error, 'queued reader reflow');
  } finally {
    state.reflow.active = false;
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
    const committed = await createAndCommitViewRevision(
      state,
      request,
      previewWorker,
      'preview',
      previousRevisionId,
    );
    if (committed?.followUp) {
      scheduleDeferredFullReflow(state, request, committed.followUp);
      return;
    }
    if (committed) return;
  }
  await createAndCommitFullRevision(state, request, previousRevisionId);
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
    state.reflow.deferred = undefined;
    if (!pending || state.disposed || state.reflow.active || state.reflow.queued) return;
    state.reflow.lastError = undefined;
    void createAndCommitFullRevision(state, pending.request, pending.followUp.previousRevisionId)
      .catch((error: unknown) => {
        reportReflowError(state, error, 'deferred full reader reflow');
      })
      .finally(() => {
        if (!state.disposed && state.reflow.queued) scheduleReflowDrain(state);
      });
  }, followUp.delayMs);
}

async function createAndCommitFullRevision(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  previousRevisionId: string | undefined,
): Promise<void> {
  const worker = await fullReflowWorker(state);
  const workerPreviousRevisionId = state.worker === worker ? previousRevisionId : undefined;
  await createAndCommitViewRevision(state, request, worker, 'full', workerPreviousRevisionId);
}

async function createAndCommitViewRevision(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  mode: 'preview' | 'full',
  previousRevisionId: string | undefined,
  onPreviewCommitted?: () => void,
): Promise<CommittedViewRevision | undefined> {
  const view = await worker.createViewRevision({
    layoutConfig: toCoreLayoutConfig(request.config),
    lineBreaking: request.lineBreaking,
    activeSpreadIndex: state.activeSpreadIndex,
    mode,
    ...(previousRevisionId !== undefined ? { previousRevisionId } : {}),
  });
  if (view.display === 'visualPreview') {
    const committed = await commitBrowserReaderViewResult(
      state,
      request,
      worker,
      view.result,
      true,
    );
    return committed ? { kind: view.kind, followUp: view.followUp } : undefined;
  }
  const onCommitted = view.kind === 'full' ? request.onCommitted : onPreviewCommitted;
  const committed = await commitBrowserReaderViewResult(
    state,
    request,
    worker,
    view.result,
    false,
    onCommitted,
  );
  return committed ? { kind: view.kind, followUp: view.followUp } : undefined;
}

function scheduleReflowDrain(state: BrowserReaderState): void {
  if (state.disposed || state.reflow.active) return;
  if (state.revisionBundle.revision.revisionId.length === 0) {
    void drainReflowQueue(state);
    return;
  }
  scheduleMicrotask(state, () => void drainReflowQueue(state));
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
  ) {
    return false;
  }
  if (state.visualPreview) return visualConfigMatches(state, config, spreadMode, lineBreaking);
  if (
    state.reflow.queued &&
    !reflowRequestEqual(state.reflow.queued, config, spreadMode, lineBreaking)
  ) {
    return false;
  }
  if (
    state.reflow.deferred &&
    !reflowRequestEqual(state.reflow.deferred.request, config, spreadMode, lineBreaking)
  ) {
    return false;
  }
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
