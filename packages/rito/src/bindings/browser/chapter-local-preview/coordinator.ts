import type { ReaderLocator, ReaderLocatorResolution } from '../../../reader';
import { toCoreLayoutConfig } from '../reader-layout';
import { copyReaderLocator } from '../reader/interaction-capture';
import { trackBrowserReaderHostTask } from '../reader/host-tasks';
import type { BrowserReaderState } from '../reader/types';
import {
  bindBrowserReaderContinuationBatchIntent,
  type BrowserReaderContinuationBatchIntent,
} from '../adaptive-continuation-batch';
import { buildBrowserReaderChapterLocalPreview } from './task';
import { previewTarget } from './target';
import {
  closeBrowserReaderChapterLocalImages,
  releaseBrowserReaderChapterLocalOwner,
} from './task-support';
import {
  browserReaderChapterLocalLocatorHasAnchorConflict,
  canonicalizeBrowserReaderChapterLocalLocator,
  notifyBrowserReaderChapterLocalPreviewInvalidated,
  sameBrowserReaderChapterLocalOwner,
} from './state';
import { browserReaderChapterLocalTransport } from './transport';
import type {
  BrowserReaderChapterLocalOwner,
  BrowserReaderChapterLocalPreviewRequest,
} from './types';

export function beginBrowserReaderChapterLocalPreview(
  state: BrowserReaderState,
  locator: ReaderLocator,
  continuationBatchIntent?: BrowserReaderContinuationBatchIntent,
): BrowserReaderChapterLocalPreviewRequest | undefined {
  if (browserReaderChapterLocalLocatorHasAnchorConflict(locator)) return undefined;
  const transport = browserReaderChapterLocalTransport(state.worker);
  const localLocator = canonicalizeBrowserReaderChapterLocalLocator(locator);
  const target = previewTarget(state, localLocator);
  if (!transport || !target || state.disposed) return undefined;
  const request: BrowserReaderChapterLocalPreviewRequest = {
    id: ++state.chapterLocalPreview.nextRequestId,
    locator: copyReaderLocator(localLocator),
    targetChapterIndex: target.chapterIndex,
    targetChapterHref: target.chapterHref,
    mountSpreadIndex: state.activeSpreadIndex,
    direction: frozenPreviewDirection(state, target.chapterIndex),
    layoutConfig: toCoreLayoutConfig(state.config, state.fontMetrics),
    spreadMode: state.spreadMode,
    lineBreaking: state.lineBreaking,
    workerSessionId: transport.workerSessionId,
    tocEntry: target.tocEntry,
    transport,
    mainSettled: false,
  };
  if (continuationBatchIntent) {
    bindBrowserReaderContinuationBatchIntent(request, continuationBatchIntent);
  }
  state.chapterLocalPreview.latestRequestId = request.id;
  retireVisiblePreview(state, true, true);
  const task = trackBrowserReaderHostTask(
    state,
    buildBrowserReaderChapterLocalPreview(state, request),
  );
  void task.catch((error: unknown) => {
    if (!state.disposed && request.id === state.chapterLocalPreview.latestRequestId) {
      try {
        state.logger.warn('reader chapter-local preview failed; using absolute pagination', error);
      } catch {
        // A host logger cannot turn a contained preview failure into a rejected task.
      }
      notifyBrowserReaderChapterLocalPreviewInvalidated(state, request.mountSpreadIndex);
    }
  });
  return request;
}

function frozenPreviewDirection(
  state: BrowserReaderState,
  targetChapterIndex: number,
): 'forward' | 'backward' {
  const spread = state.revisionBundle.navigation.spreads[state.activeSpreadIndex];
  const pageIndex = spread?.pageIndexes[0];
  if (pageIndex === undefined) return 'forward';
  const activeChapterIndex = state.revisionBundle.navigation.chapters.findIndex(
    (chapter) =>
      chapter.startPage !== undefined &&
      chapter.endPage !== undefined &&
      pageIndex >= chapter.startPage &&
      pageIndex < chapter.endPage,
  );
  return activeChapterIndex >= 0 && targetChapterIndex < activeChapterIndex
    ? 'backward'
    : 'forward';
}

export function settleBrowserReaderChapterLocalPreview(
  state: BrowserReaderState,
  request: BrowserReaderChapterLocalPreviewRequest | undefined,
  resolution: ReaderLocatorResolution | undefined,
): void {
  if (!request) return;
  request.mainSettled = true;
  if (request.id !== state.chapterLocalPreview.latestRequestId) return;
  const active = state.chapterLocalPreview.active;
  if (!active || active.request !== request) return;
  if (resolution?.status !== 'resolved') {
    if (active.presentationStarted) {
      active.phase = 'handoff';
      active.exactSpreadIndex = undefined;
    } else {
      retireVisiblePreview(state, true, true);
    }
    return;
  }
  active.phase = 'handoff';
  active.exactSpreadIndex = resolution.spreadIndex;
  if (!active.presentationStarted) {
    retireVisiblePreview(state, true, true);
  }
}

export function finishBrowserReaderChapterLocalPresentation(
  state: BrowserReaderState,
  requestId: number,
  owner: BrowserReaderChapterLocalOwner,
  _transitionSettled: boolean,
): boolean {
  const active = state.chapterLocalPreview.active;
  if (
    !active ||
    active.request.id !== requestId ||
    !sameBrowserReaderChapterLocalOwner(active.owner, owner)
  ) {
    return false;
  }
  retireVisiblePreview(state, false, true);
  return true;
}

export function notifyBrowserReaderChapterLocalActiveSpread(
  state: BrowserReaderState,
  spreadIndex: number,
): void {
  const active = state.chapterLocalPreview.active;
  if (!active) return;
  if (active.phase === 'handoff' && active.exactSpreadIndex === spreadIndex) {
    retireVisiblePreview(state, active.request.mountSpreadIndex === spreadIndex, true);
    return;
  }
  if (spreadIndex !== active.request.mountSpreadIndex) {
    retireVisiblePreview(state, false, true);
  }
}

export function supersedeBrowserReaderChapterLocalPreview(
  state: BrowserReaderState,
  invalidateMount = true,
): void {
  state.chapterLocalPreview.latestRequestId = ++state.chapterLocalPreview.nextRequestId;
  retireVisiblePreview(state, invalidateMount, true);
}

export function disposeBrowserReaderChapterLocalPreview(state: BrowserReaderState): void {
  state.chapterLocalPreview.latestRequestId = ++state.chapterLocalPreview.nextRequestId;
  // The owning document's disposal releases any in-flight local revision. Do
  // not enqueue a late Worker request after disposal has started.
  retireVisiblePreview(state, false, false);
}

function retireVisiblePreview(
  state: BrowserReaderState,
  invalidateMount: boolean,
  releaseOwner: boolean,
): void {
  const active = state.chapterLocalPreview.active;
  if (!active) return;
  state.chapterLocalPreview.active = undefined;
  closeBrowserReaderChapterLocalImages(active.images);
  if (invalidateMount) {
    notifyBrowserReaderChapterLocalPreviewInvalidated(state, active.request.mountSpreadIndex);
  }
  if (releaseOwner) {
    const releaseTask = trackBrowserReaderHostTask(
      state,
      releaseBrowserReaderChapterLocalOwner(state, active.request, active.owner),
    );
    // The release helper already fails the session closed and records the
    // ownership error. Consume this fire-and-forget rejection after tracking
    // it so normal presentation retirement cannot surface an unhandled task.
    void releaseTask.catch(() => undefined);
  }
}
