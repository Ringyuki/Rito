import type { LayoutConfig } from '../../../reader';
import { applyBrowserReaderFrameWindow, cacheFrame, resetFrameCache } from './frame-cache';
import { resetBrowserReaderInteractionCache } from './interaction';
import { preloadVisualPreviewFrameResources } from '../resources';
import { prepareRequiredRevisionFonts } from '../required-fonts';
import {
  prepareBrowserReaderCommitFrame,
  requireBrowserReaderLocatorSelectedFrame as requireLocatorSelectedFrame,
  type BrowserReaderPreparedViewCommitOptions,
} from '../revision-commit';
import {
  createRitoCoreWasmReaderChapterTextIndexMap,
  createRitoCoreWasmReaderFootnoteMap,
} from '../core-contracts';
import type { CoreLineBreaking } from './types';
import type {
  BrowserReaderFrame,
  BrowserReaderLocatorNavigation,
  BrowserReaderQueuedReflow,
  BrowserReaderState,
  BrowserReaderVisualPreview,
} from './types';
import type { BrowserReaderRevisionResult, BrowserReaderWorkerClient } from '../core-contracts';
import {
  commitRevisionHandle,
  createWorkerRevisionHandle,
  currentCommitGeneration,
} from './pipeline/revision-handle';
import { openBrowserReaderWorker } from '../pinned-fonts';
export interface BrowserReaderRevisionStateInput {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: 'greedy' | 'optimal';
  readonly result: BrowserReaderRevisionResult;
  readonly worker: BrowserReaderWorkerClient;
  readonly initialFrame?: BrowserReaderFrame | undefined;
}
export async function fullReflowWorker(
  state: BrowserReaderState,
): Promise<BrowserReaderWorkerClient> {
  if (typeof Worker === 'undefined') return state.foregroundWorker;
  if (state.worker !== state.foregroundWorker) return state.foregroundWorker;
  if (state.fullReflowWorker) {
    await state.fullReflowOpenPromise;
    return state.fullReflowWorker;
  }
  const worker = state.workerFactory();
  state.fullReflowWorker = worker;
  state.fullReflowOpenPromise = openBrowserReaderWorker(
    worker,
    state.documentData.slice(0),
    state.pinnedFonts.policy,
    state.pinnedFonts.summary,
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      if (state.fullReflowWorker === worker) {
        state.fullReflowWorker = undefined;
        state.fullReflowOpenPromise = undefined;
      }
      worker.dispose();
      throw error;
    });
  await state.fullReflowOpenPromise;
  if (state.disposed) {
    worker.dispose();
    throw new Error('Browser reader was disposed while opening full reflow worker');
  }
  return worker;
}
export function disposeInactiveWorker(
  state: BrowserReaderState,
  previousWorker: BrowserReaderWorkerClient,
  nextWorker: BrowserReaderWorkerClient,
): void {
  if (previousWorker === nextWorker || previousWorker === state.foregroundWorker) return;
  previousWorker.dispose();
  if (state.fullReflowWorker === previousWorker) {
    state.fullReflowWorker = undefined;
    state.fullReflowOpenPromise = undefined;
  }
}
export function applyBrowserReaderRevisionState(
  state: BrowserReaderState,
  input: BrowserReaderRevisionStateInput,
): void {
  const previousWorker = state.worker;
  const previousRevisionId = state.revisionBundle.revision.revisionId;
  clearBrowserReaderVisualPreview(state);
  state.worker = input.worker;
  state.revisionHandle = commitRevisionHandle(
    state,
    input.worker,
    input.result.bundle.revision.revisionId,
    input.result.bundle.revision.revisionVersion,
  );
  applyLayoutState(state, input);
  applyRevisionData(state, input.result);
  if (input.initialFrame) cacheFrame(state, input.initialFrame.spreadIndex, input.initialFrame);
  applyBrowserReaderFrameWindow(state, state.revisionHandle, input.result.frameWindow, {
    notifyFrameInvalidation: false,
  });
  if (
    previousRevisionId.length > 0 &&
    (previousWorker !== input.worker ||
      previousRevisionId !== input.result.bundle.revision.revisionId)
  ) {
    releaseRevision(previousWorker, previousRevisionId);
  }
  disposeInactiveWorker(state, previousWorker, input.worker);
}
export async function commitBrowserReaderViewResult(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
  visualPreview: boolean,
  onCommitted?: () => void,
  baseCommitGeneration = currentCommitGeneration(state),
  expectedActiveSpreadIndex?: number,
  expectedLocatorNavigation?: BrowserReaderLocatorNavigation,
): Promise<boolean | 'staleSpread'> {
  if (shouldDiscardReflowResult(state, request, baseCommitGeneration)) {
    return releaseDiscarded(worker, result);
  }
  if (navigationChanged(state, expectedActiveSpreadIndex, expectedLocatorNavigation)) {
    releaseDiscarded(worker, result);
    return 'staleSpread';
  }
  if (expectedLocatorNavigation) requireLocatorSelectedFrame(worker, result, visualPreview);
  const rollbackFonts = await prepareRequiredRevisionFonts(
    state,
    worker,
    result.bundle,
    () => !shouldDiscardReflowResult(state, request, baseCommitGeneration),
  );
  if (!rollbackFonts) return false;
  if (navigationChanged(state, expectedActiveSpreadIndex, expectedLocatorNavigation)) {
    rollbackFonts();
    releaseDiscarded(worker, result);
    return 'staleSpread';
  }
  const commitFrame = await prepareBrowserReaderCommitFrame(state, worker, result, rollbackFonts);
  if (shouldDiscardReflowResult(state, request, baseCommitGeneration)) {
    rollbackFonts();
    return releaseDiscarded(worker, result);
  }
  if (navigationChanged(state, expectedActiveSpreadIndex, expectedLocatorNavigation)) {
    rollbackFonts();
    releaseDiscarded(worker, result);
    return 'staleSpread';
  }
  return publishPreparedView(state, request, worker, result, {
    visualPreview,
    onCommitted,
    baseCommitGeneration,
    expectedLocatorNavigation,
    rollbackFonts,
    commitFrame,
  });
}
function publishPreparedView(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
  prepared: BrowserReaderPreparedViewCommitOptions,
): boolean {
  if (prepared.visualPreview) {
    try {
      const committed = commitVisualPreview(
        state,
        request,
        worker,
        result,
        prepared.commitFrame,
        prepared.baseCommitGeneration,
      );
      if (!committed) prepared.rollbackFonts();
      return committed;
    } catch (error) {
      prepared.rollbackFonts();
      throw error;
    }
  }
  applyBrowserReaderRevisionState(state, {
    config: request.config,
    spreadMode: request.spreadMode,
    lineBreaking: request.lineBreaking,
    result,
    worker,
    initialFrame: prepared.commitFrame.frame,
  });
  state.activeSpreadIndex = prepared.commitFrame.frame?.spreadIndex ?? clampedActiveSpread(state);
  if (
    prepared.expectedLocatorNavigation !== undefined &&
    state.reflow.locatorNavigation === prepared.expectedLocatorNavigation
  ) {
    prepared.expectedLocatorNavigation.phase = 'settling';
  }
  notifyReaderListener(state, 'reader layout commit callback', prepared.onCommitted);
  for (const cb of state.layoutCommittedListeners) {
    notifyReaderListener(state, 'reader layout committed listener', () => {
      cb(state.activeSpreadIndex);
    });
  }
  return true;
}
export function commitBrowserReaderVisualPreview(
  state: BrowserReaderState,
  preview: {
    readonly config: LayoutConfig;
    readonly spreadMode: 'single' | 'double';
    readonly lineBreaking: CoreLineBreaking;
    readonly worker: BrowserReaderWorkerClient;
    readonly revision: BrowserReaderVisualPreview['revision'];
    readonly baseCommitGeneration: number;
    readonly spreadIndex: number;
    readonly frame: BrowserReaderFrame;
  },
): void {
  clearBrowserReaderVisualPreview(state);
  state.visualPreview = {
    revision: preview.revision,
    baseCommitGeneration: preview.baseCommitGeneration,
    interactionPolicy: 'disabled',
    spreadIndex: preview.spreadIndex,
    frame: preview.frame,
    config: preview.config,
    spreadMode: preview.spreadMode,
    lineBreaking: preview.lineBreaking,
    worker: preview.worker,
  };
  for (const cb of state.spreadContentInvalidatedListeners) {
    notifyReaderListener(state, 'reader spread invalidated listener', () => {
      cb(preview.spreadIndex);
    });
  }
}
export function clearBrowserReaderVisualPreview(state: BrowserReaderState): void {
  const preview = state.visualPreview;
  state.visualPreview = undefined;
  if (preview) releaseRevision(preview.worker, preview.revision.revisionId);
}

export function visualLayoutConfig(state: BrowserReaderState): LayoutConfig {
  return state.visualPreview?.config ?? state.config;
}

export function visualPreviewFrame(
  state: BrowserReaderState,
  spreadIndex: number,
): BrowserReaderFrame | undefined {
  const preview = state.visualPreview;
  if (!preview || preview.spreadIndex !== spreadIndex) return undefined;
  return preview.frame;
}

function shouldDiscardReflowResult(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  baseCommitGeneration: number,
): boolean {
  return (
    state.disposed ||
    state.reflow.queued !== undefined ||
    request.token !== state.reflow.token ||
    currentCommitGeneration(state) !== baseCommitGeneration
  );
}

function navigationChanged(
  state: BrowserReaderState,
  expectedActiveSpreadIndex: number | undefined,
  expectedLocatorNavigation: BrowserReaderLocatorNavigation | undefined,
): boolean {
  return (
    (expectedActiveSpreadIndex !== undefined &&
      state.activeSpreadIndex !== expectedActiveSpreadIndex) ||
    (expectedLocatorNavigation !== undefined &&
      state.reflow.locatorNavigation !== expectedLocatorNavigation)
  );
}

function clampedActiveSpread(state: BrowserReaderState): number {
  return Math.max(
    0,
    Math.min(state.activeSpreadIndex, state.revisionBundle.revision.spreadCount - 1),
  );
}

function releaseDiscarded(
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
): false {
  releaseRevision(worker, result.bundle.revision.revisionId);
  return false;
}

function releaseRevision(worker: BrowserReaderWorkerClient, revisionId: string): void {
  void worker.releaseRevision(revisionId).catch(() => undefined);
}

function commitVisualPreview(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
  commitFrame: Awaited<ReturnType<typeof prepareBrowserReaderCommitFrame>>,
  baseCommitGeneration: number,
): boolean {
  const displaySpreadIndex = commitFrame.displaySpreadIndex;
  if (!commitFrame.frame) return releaseDiscarded(worker, result);
  if (displaySpreadIndex !== state.activeSpreadIndex) {
    releaseDiscarded(worker, result);
    throw new Error('Reader visual preview frame does not match its requested spread');
  }
  commitBrowserReaderVisualPreview(state, {
    config: request.config,
    spreadMode: request.spreadMode,
    lineBreaking: request.lineBreaking,
    worker,
    revision: createWorkerRevisionHandle(
      worker,
      result.bundle.revision.revisionId,
      result.bundle.revision.revisionVersion,
    ),
    baseCommitGeneration,
    spreadIndex: displaySpreadIndex,
    frame: commitFrame.frame,
  });
  if (!commitFrame.frame.imageDominated)
    preloadVisualPreviewFrameResources(state, commitFrame.resources);
  return true;
}

function applyLayoutState(
  state: BrowserReaderState,
  input: Pick<BrowserReaderRevisionStateInput, 'config' | 'spreadMode' | 'lineBreaking'>,
): void {
  state.config = input.config;
  state.spreadMode = input.spreadMode;
  state.lineBreaking = input.lineBreaking;
}

function applyRevisionData(state: BrowserReaderState, result: BrowserReaderRevisionResult): void {
  const { bundle } = result;
  state.revisionBundle = bundle;
  resetFrameCache(state);
  resetBrowserReaderInteractionCache(state);
  state.footnotes = createRitoCoreWasmReaderFootnoteMap(bundle.footnotes);
  state.chapterTextIndices = createRitoCoreWasmReaderChapterTextIndexMap(bundle.chapterTextIndices);
  if (!result.preview || bundle.tocTargets.targets.length > 0 || state.tocTargets.length === 0) {
    state.tocTargets = bundle.tocTargets.targets;
  }
}

function notifyReaderListener(
  state: BrowserReaderState,
  label: string,
  listener: (() => void) | undefined,
): void {
  if (!listener) return;
  try {
    listener();
  } catch (error) {
    state.logger.warn(`${label} failed`, error);
  }
}
