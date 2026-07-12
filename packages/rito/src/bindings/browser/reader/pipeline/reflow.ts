import type { ReaderOptions } from '../../../../reader';
import { applyLayoutOverrides, makeBrowserReaderLayoutConfig, toCoreLayoutConfig } from '../layout';
import { commitBrowserReaderViewResult, fullReflowWorker } from '../revision';
import { currentCommitGeneration } from './revision-handle';
import type { BrowserReaderQueuedReflow, BrowserReaderState } from '../types';
import type {
  CoreViewRevisionRequest,
  BrowserReaderViewRevisionResult,
  BrowserReaderWorkerClient,
} from '../../core-contracts';
import {
  isNoOpReflow,
  isStaleReflow,
  reportReflowError,
  scheduleReaderMicrotask,
} from './reflow-state';
import { captureBrowserReaderReflowAnchor, retryStaleReflow } from './reflow-anchor';

type ResolvedViewRevision = Pick<BrowserReaderViewRevisionResult, 'kind' | 'followUp'>;
type ViewRevisionAttempt = ResolvedViewRevision | 'staleSpread' | undefined;
type BeforeInitialFullReflow = () => Promise<boolean | undefined>;

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
  beforeFullReflow?: BeforeInitialFullReflow,
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
    const resolved = await createAndCommitStableViewRevision(
      state,
      request,
      state.foregroundWorker,
      'preview',
      undefined,
      onPreviewCommitted,
    );
    continueInitialReflow(state, request, resolved, beforeFullReflow);
  } catch (error) {
    const wrapped = reportReflowError(state, error, 'initial reader reflow');
    if (state.revisionBundle.revision.revisionId.length === 0) throw wrapped;
  } finally {
    state.reflow.active = undefined;
    if (!state.disposed && state.reflow.queued) scheduleReflowDrain(state);
  }
}

function continueInitialReflow(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  resolved: ResolvedViewRevision | undefined,
  beforeFullReflow: BeforeInitialFullReflow | undefined,
): void {
  const continuation = beforeFullReflow
    ? refreshInitialPreview(state, request, resolved, beforeFullReflow).catch((error: unknown) => {
        if (isStaleReflow(state, request)) return undefined;
        reportReflowError(state, error, 'initial reader font reflow');
        return resolved;
      })
    : Promise.resolve(resolved);
  void continuation
    .then((refreshed) => {
      if (isStaleReflow(state, request)) return;
      if (refreshed?.followUp) scheduleInitialFollowUp(state, request, refreshed.followUp);
    })
    .catch((error: unknown) => {
      if (!isStaleReflow(state, request))
        reportReflowError(state, error, 'initial reader follow-up');
    });
}

async function refreshInitialPreview(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  resolved: ResolvedViewRevision | undefined,
  beforeFullReflow: BeforeInitialFullReflow,
): Promise<ResolvedViewRevision | undefined> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (isStaleReflow(state, request)) return;
  const metricsChanged = (await beforeFullReflow()) === true;
  if (isStaleReflow(state, request)) return;
  const previousRevisionId = state.revisionBundle.revision.revisionId;
  if (!metricsChanged || previousRevisionId.length === 0) return resolved;
  return createAndCommitStableViewRevision(
    state,
    request,
    state.foregroundWorker,
    'preview',
    previousRevisionId,
  );
}

function scheduleInitialFollowUp(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  followUp: NonNullable<BrowserReaderViewRevisionResult['followUp']>,
): void {
  scheduleDeferredFullReflow(state, request, {
    ...followUp,
    request: {
      ...followUp.request,
      layoutConfig: toCoreLayoutConfig(request.config, state.fontMetrics),
    },
  });
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
    const previewWorker = state.worker;
    const resolved = await createAndCommitStableViewRevision(
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
  await createAndCommitStableViewRevision(state, request, worker, workerRequest, previousId);
}

async function createAndCommitStableViewRevision(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  workerRequest: CoreViewRevisionRequest | 'preview' | 'full',
  previousRevisionId: string | undefined,
  onPreviewCommitted?: () => void,
): Promise<ResolvedViewRevision | undefined> {
  return retryStaleReflow(state, request, () =>
    createAndCommitViewRevision(
      state,
      request,
      worker,
      workerRequest,
      previousRevisionId,
      onPreviewCommitted,
    ),
  );
}

async function createAndCommitViewRevision(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  workerRequest: CoreViewRevisionRequest | 'preview' | 'full',
  previousRevisionId: string | undefined,
  onPreviewCommitted?: () => void,
): Promise<ViewRevisionAttempt> {
  const positionRead = captureBrowserReaderReflowAnchor(state);
  const position = positionRead instanceof Promise ? await positionRead : positionRead;
  if (position.status === 'stale') return 'staleSpread';
  if (isStaleReflow(state, request)) return undefined;
  const dispatchRequest =
    typeof workerRequest === 'string'
      ? {
          layoutConfig: toCoreLayoutConfig(request.config, state.fontMetrics),
          lineBreaking: request.lineBreaking,
          activeSpreadIndex: position.activeSpreadIndex,
          mode: workerRequest,
          ...(previousRevisionId !== undefined ? { previousRevisionId } : {}),
        }
      : workerRequest;
  const { preserveLocator: _preserveLocator, ...baseDispatchRequest } = dispatchRequest;
  const baseCommitGeneration = currentCommitGeneration(state);
  const view = await worker.createViewRevision({
    ...baseDispatchRequest,
    activeSpreadIndex: position.activeSpreadIndex,
    ...(position.preserveLocator ? { preserveLocator: position.preserveLocator } : {}),
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
    baseCommitGeneration,
    position.activeSpreadIndex,
  );
  if (commit === 'staleSpread') return 'staleSpread';
  return commit ? { kind: view.kind, followUp: view.followUp } : undefined;
}

function scheduleReflowDrain(state: BrowserReaderState): void {
  if (state.disposed || state.reflow.active) return;
  if (state.revisionBundle.revision.revisionId.length === 0) void drainReflowQueue(state);
  else scheduleReaderMicrotask(state, () => void drainReflowQueue(state));
}
