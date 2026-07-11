import type { LayoutConfig } from '../../../reader';
import { applyBrowserReaderFrameWindow, cacheFrame, resetFrameCache } from './frame-cache';
import { decodeBrowserReaderFrame } from './frame';
import { preloadFrameResourceBytes, preloadVisualPreviewFrameResources } from '../resources';
import {
  createRitoCoreWasmReaderChapterTextIndexMap,
  createRitoCoreWasmReaderFootnoteMap,
} from '../core-contracts';
import type { CoreLineBreaking } from './types';
import type { BrowserReaderFrame, BrowserReaderQueuedReflow, BrowserReaderState } from './types';
import type { BrowserReaderRevisionResult, BrowserReaderWorkerClient } from '../core-contracts';

export interface BrowserReaderRevisionStateInput {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: 'greedy' | 'optimal';
  readonly result: BrowserReaderRevisionResult;
  readonly worker: BrowserReaderWorkerClient;
  readonly initialFrame?: BrowserReaderFrame | undefined;
}

export function activePreviewWorker(state: BrowserReaderState): BrowserReaderWorkerClient {
  return state.worker;
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
  state.fullReflowOpenPromise = worker
    .open(state.documentData.slice(0))
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
  applyLayoutState(state, input);
  applyRevisionData(state, input.result);
  if (input.initialFrame) cacheFrame(state, input.initialFrame.spreadIndex, input.initialFrame);
  applyBrowserReaderFrameWindow(
    state,
    input.result.bundle.revision.revisionId,
    input.result.frameWindow,
    {
      notifyFrameInvalidation: false,
    },
  );
  if (
    previousRevisionId.length > 0 &&
    (previousWorker !== input.worker ||
      previousRevisionId !== input.result.bundle.revision.revisionId)
  ) {
    releaseRevision(previousWorker, previousRevisionId);
  }
  disposeInactiveWorker(state, previousWorker, input.worker);
}

export function notifyBrowserReaderLayoutCommitted(state: BrowserReaderState): void {
  for (const cb of state.layoutCommittedListeners) cb();
}

export async function commitBrowserReaderViewResult(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
  visualPreview: boolean,
  onCommitted?: () => void,
): Promise<boolean | 'staleSpread'> {
  if (shouldDiscardReflowResult(state, request)) return releaseDiscarded(worker, result);
  const commitFrame = await prepareCommitFrame(state, worker, result);
  if (shouldDiscardReflowResult(state, request)) return releaseDiscarded(worker, result);
  if (visualPreview) return commitVisualPreview(state, request, worker, result, commitFrame);
  applyBrowserReaderRevisionState(state, {
    config: request.config,
    spreadMode: request.spreadMode,
    lineBreaking: request.lineBreaking,
    result,
    worker,
    initialFrame: commitFrame.frame,
  });
  onCommitted?.();
  notifyBrowserReaderLayoutCommitted(state);
  return true;
}

export function commitBrowserReaderVisualPreview(
  state: BrowserReaderState,
  preview: {
    readonly config: LayoutConfig;
    readonly spreadMode: 'single' | 'double';
    readonly lineBreaking: CoreLineBreaking;
    readonly worker: BrowserReaderWorkerClient;
    readonly revisionId: string;
    readonly spreadIndex: number;
    readonly frame: BrowserReaderFrame;
  },
): void {
  clearBrowserReaderVisualPreview(state);
  state.visualPreview = {
    revisionId: preview.revisionId,
    spreadIndex: preview.spreadIndex,
    frame: preview.frame,
    config: preview.config,
    spreadMode: preview.spreadMode,
    lineBreaking: preview.lineBreaking,
    worker: preview.worker,
  };
  for (const cb of state.spreadContentInvalidatedListeners) cb(preview.spreadIndex);
}

export function clearBrowserReaderVisualPreview(state: BrowserReaderState): void {
  const preview = state.visualPreview;
  state.visualPreview = undefined;
  if (preview) releaseRevision(preview.worker, preview.revisionId);
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

export function visualConfigMatches(
  state: BrowserReaderState,
  config: LayoutConfig,
  spreadMode: 'single' | 'double',
  lineBreaking: CoreLineBreaking,
): boolean {
  const preview = state.visualPreview;
  return (
    !!preview &&
    JSON.stringify(preview.config) === JSON.stringify(config) &&
    preview.spreadMode === spreadMode &&
    preview.lineBreaking === lineBreaking
  );
}

function shouldDiscardReflowResult(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
): boolean {
  return (
    state.disposed || state.reflow.queued !== undefined || request.token !== state.reflow.token
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

async function prepareCommitFrame(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
) {
  try {
    const selection = result.selectedFrame;
    if (!selection || selection.spreadIndex >= result.bundle.revision.spreadCount) return {};
    const frame = decodeBrowserReaderFrame(
      state.decodeFrameCommandBuffer,
      result.bundle.revision.revisionId,
      selection.spreadIndex,
      selection.frame,
    );
    const resources = result.frameWindow?.spreads.find(
      (spread) => spread.spreadIndex === selection.spreadIndex,
    )?.resources;
    if (frame.imageDominated && resources) await preloadFrameResourceBytes(state, resources);
    return { displaySpreadIndex: selection.displaySpreadIndex, frame, resources };
  } catch (error) {
    releaseDiscarded(worker, result);
    throw error;
  }
}

function commitVisualPreview(
  state: BrowserReaderState,
  request: BrowserReaderQueuedReflow,
  worker: BrowserReaderWorkerClient,
  result: BrowserReaderRevisionResult,
  commitFrame: Awaited<ReturnType<typeof prepareCommitFrame>>,
): boolean | 'staleSpread' {
  const displaySpreadIndex = commitFrame.displaySpreadIndex;
  if (!commitFrame.frame) return releaseDiscarded(worker, result);
  if (displaySpreadIndex !== state.activeSpreadIndex) {
    releaseDiscarded(worker, result);
    return 'staleSpread';
  }
  commitBrowserReaderVisualPreview(state, {
    config: request.config,
    spreadMode: request.spreadMode,
    lineBreaking: request.lineBreaking,
    worker,
    revisionId: result.bundle.revision.revisionId,
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
  state.footnotes = createRitoCoreWasmReaderFootnoteMap(bundle.footnotes);
  state.chapterTextIndices = createRitoCoreWasmReaderChapterTextIndexMap(bundle.chapterTextIndices);
  if (!result.preview || bundle.tocTargets.targets.length > 0 || state.tocTargets.length === 0) {
    state.tocTargets = bundle.tocTargets.targets;
  }
}
