import type { LayoutConfig } from '../../../reader';
import {
  createRitoCoreWasmReaderChapterTextIndexMap,
  createRitoCoreWasmReaderFootnoteMap,
  type BrowserReaderRevisionResult,
  type BrowserReaderWorkerClient,
} from '../core-contracts';
import { applyBrowserReaderFrameWindow, cacheFrame, resetFrameCache } from './frame-cache';
import { resetBrowserReaderInteractionCache } from './interaction';
import { commitRevisionHandle } from './pipeline/revision-handle';
import type { BrowserReaderFrame, BrowserReaderState } from './types';

export interface BrowserReaderRevisionStateInput {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: 'greedy' | 'optimal';
  readonly result: BrowserReaderRevisionResult;
  readonly worker: BrowserReaderWorkerClient;
  readonly initialFrame?: BrowserReaderFrame | undefined;
}

export function applyBrowserReaderRevisionState(
  state: BrowserReaderState,
  input: BrowserReaderRevisionStateInput,
): void {
  state.worker = input.worker;
  state.revisionHandle = commitRevisionHandle(
    state,
    input.worker,
    input.result.bundle.revision.revisionId,
    input.result.bundle.revision.revisionVersion,
  );
  state.config = input.config;
  state.spreadMode = input.spreadMode;
  state.lineBreaking = input.lineBreaking;
  applyRevisionData(state, input.result);
  if (input.initialFrame) cacheFrame(state, input.initialFrame.spreadIndex, input.initialFrame);
  applyBrowserReaderFrameWindow(state, state.revisionHandle, input.result.frameWindow, {
    notifyFrameInvalidation: false,
  });
}

function applyRevisionData(state: BrowserReaderState, result: BrowserReaderRevisionResult): void {
  const { bundle } = result;
  state.revisionBundle = bundle;
  resetFrameCache(state);
  resetBrowserReaderInteractionCache(state);
  state.footnotes = createRitoCoreWasmReaderFootnoteMap(bundle.footnotes);
  state.chapterTextIndices = createRitoCoreWasmReaderChapterTextIndexMap(bundle.chapterTextIndices);
  state.tocTargets = bundle.tocTargets.targets;
}
