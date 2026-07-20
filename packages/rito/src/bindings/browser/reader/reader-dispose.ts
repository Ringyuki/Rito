import { disposeBrowserReaderPinnedFonts } from '../pinned-fonts';
import { disposeBrowserReaderSessionHosts } from '../reader-session-host';
import { unregisterReaderFonts } from '../resources';
import { resetFrameCache } from './frame-cache';
import { resetBrowserReaderInteractionCache } from './interaction';
import { cancelBrowserReaderReflow } from './pipeline/bounded-reflow';
import { createEmptyBrowserReaderRevisionState } from './pipeline/initial-state';
import type { BrowserReaderState } from './types';
import { drainBrowserReaderHostTasks } from './host-tasks';
import { resetBrowserReaderLayoutViewCache } from '../reader-layout';
import { disposeBrowserReaderChapterLocalPreview } from '../chapter-local-preview/coordinator';

export function disposeBrowserReaderState(state: BrowserReaderState): void {
  if (state.disposed) return;
  state.disposed = true;
  runReaderCleanup(state, 'chapter-local preview release', () => {
    disposeBrowserReaderChapterLocalPreview(state);
  });
  runReaderCleanup(state, 'reflow cancellation', () => {
    cancelBrowserReaderReflow(state);
  });
  state.spreadRenderedListeners.clear();
  state.spreadContentInvalidatedListeners.clear();
  state.layoutCommittedListeners.clear();
  runReaderCleanup(state, 'session release', () => {
    disposeBrowserReaderSessionHosts(state);
  });
  runReaderCleanup(state, 'interaction cache release', () => {
    resetBrowserReaderInteractionCache(state);
  });
  runReaderCleanup(state, 'frame cache release', () => {
    resetFrameCache(state);
  });
  runReaderCleanup(state, 'layout view cache release', () => {
    resetBrowserReaderLayoutViewCache(state);
  });
  runReaderCleanup(state, 'publication font release', () => {
    unregisterReaderFonts(state);
  });
  runReaderCleanup(state, 'pinned font release', () => {
    disposeBrowserReaderPinnedFonts(state.pinnedFonts);
  });
  runReaderCleanup(state, 'image release', () => {
    releaseReaderImages(state);
  });
  runReaderCleanup(state, 'retained data release', () => {
    releaseRetainedReaderData(state);
  });
  const sessionTask = state.disposeTask ?? Promise.resolve();
  state.disposeTask = Promise.all([sessionTask, drainBrowserReaderHostTasks(state)]).then(
    () => undefined,
  );
}

function releaseRetainedReaderData(state: BrowserReaderState): void {
  state.documentData = new ArrayBuffer(0);
  state.revisionBundle = createEmptyBrowserReaderRevisionState().revisionBundle;
  state.revisionHandle = undefined;
  state.footnotes = new Map();
  state.chapterTextIndices = new Map();
  state.tocTargets = [];
  state.fontMetrics.genericSerif = undefined;
  for (const family of Object.keys(state.fontMetrics.fontFamilies)) {
    Reflect.deleteProperty(state.fontMetrics.fontFamilies, family);
  }
  for (const key of Object.keys(state.fontMetrics.verticalMetrics)) {
    Reflect.deleteProperty(state.fontMetrics.verticalMetrics, key);
  }
  state.reflow.lastError = undefined;
}

function releaseReaderImages(state: BrowserReaderState): void {
  for (const image of state.images.values()) {
    try {
      image.close();
    } catch {
      // Continue closing the remaining reader-owned images.
    }
  }
  state.images.clear();
}

function runReaderCleanup(state: BrowserReaderState, subject: string, operation: () => void): void {
  try {
    operation();
  } catch (error) {
    try {
      state.logger.warn(`reader ${subject} failed`, error);
    } catch {
      // Logging must never interrupt the remaining reader cleanup stages.
    }
  }
}
