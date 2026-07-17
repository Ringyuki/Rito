import type { Reader, ReaderOptions, SearchResult } from '../../../reader';
import type { CoreSearchResponse } from '../core-contracts';
import { warmBrowserReaderFrameWindow } from './frame-cache';
import { scheduleBrowserReaderReflow } from './pipeline/bounded-reflow';
import { getImageObjectUrl, preloadReaderFonts } from '../resources';
import { browserReaderSpreads } from '../reader-layout';
import {
  findRitoCoreWasmReaderActiveTocEntry,
  findRitoCoreWasmReaderSpreadContainingPage,
  findRitoCoreWasmReaderTocTarget,
} from '../core-contracts';
import {
  notifySpreadRendered,
  renderSpreadToBoundCanvas,
  renderSpreadToContext,
} from '../rendering';
import type { BrowserReaderState } from './types';
import { fallbackBrowserTextMeasurer } from '../host-runtime';
import { createBrowserReaderInteractions } from './interaction';
import {
  captureCommittedSourceRead,
  copyReaderSourcePoint,
  readCapturedSource,
} from './interaction-capture';
import {
  completeBrowserReaderBoundedSession,
  ensureBrowserReaderBoundedLocator,
} from '../bounded-session-runtime';
import { disposeBrowserReaderState } from './reader-dispose';
import { trackBrowserReaderHostTask } from './host-tasks';

export type BrowserReaderAccessorKey =
  | 'metadata'
  | 'totalSpreads'
  | 'activeSpreadIndex'
  | 'pagination'
  | 'toc'
  | 'chapterMap'
  | 'manifestHrefMap'
  | 'pages'
  | 'spreads'
  | 'dpr';

export type BrowserReaderMethodSurface = Omit<Reader, BrowserReaderAccessorKey>;
type Reflow = (next?: ReaderOptions, force?: boolean) => void;

export function buildBrowserReaderMethods(
  state: BrowserReaderState,
  options: ReaderOptions,
): BrowserReaderMethodSurface {
  let layoutOptions = options;
  const reflow: Reflow = (next = layoutOptions, force = false) => {
    layoutOptions = next;
    const spreadMode = layoutOptions.spread ?? state.spreadMode;
    const lineBreaking = layoutOptions.lineBreaking ?? state.lineBreaking;
    scheduleBrowserReaderReflow(
      state,
      layoutOptions,
      spreadMode,
      lineBreaking,
      () => {
        void trackBrowserReaderHostTask(
          state,
          preloadReaderFonts(state)
            .then((metricsChanged) => {
              if (metricsChanged) reflow(layoutOptions, true);
              return warmBrowserReaderFrameWindow(state, state.activeSpreadIndex);
            })
            .catch((error: unknown) => {
              state.logger.warn('reader font preload failed', error);
            }),
        );
      },
      force,
    );
  };

  return {
    measurer: fallbackBrowserTextMeasurer,
    interactions: createBrowserReaderInteractions(state),
    ...renderingMethods(state),
    ...layoutMethods(state, () => layoutOptions, reflow),
    ...navigationMethods(state),
    ...resourceMethods(state),
    ...listenerMethods(state),
    dispose() {
      disposeBrowserReaderState(state);
      return state.disposeTask ?? Promise.resolve();
    },
  };
}

function renderingMethods(
  state: BrowserReaderState,
): Pick<BrowserReaderMethodSurface, 'renderSpread' | 'renderSpreadTo' | 'notifyActiveSpread'> {
  return {
    renderSpread(index, scale = 1) {
      renderSpreadToBoundCanvas(state, index, scale);
      void warmBrowserReaderFrameWindow(state, index);
    },
    renderSpreadTo(index, ctx) {
      return renderSpreadToContext(state, index, ctx);
    },
    notifyActiveSpread(index) {
      notifySpreadRendered(state, index);
      void warmBrowserReaderFrameWindow(state, index);
    },
  };
}

function layoutMethods(
  state: BrowserReaderState,
  layoutOptions: () => ReaderOptions,
  reflow: Reflow,
): Pick<
  BrowserReaderMethodSurface,
  'resize' | 'setSpreadMode' | 'setLineBreaking' | 'updateLayout' | 'setTheme' | 'setTypography'
> {
  return {
    resize(width, height) {
      reflow({ ...layoutOptions(), width, height });
    },
    setSpreadMode(mode) {
      reflow({ ...layoutOptions(), spread: mode });
      return false;
    },
    setLineBreaking(lineBreaking) {
      if ((layoutOptions().lineBreaking ?? state.lineBreaking) === lineBreaking) return false;
      reflow({ ...layoutOptions(), lineBreaking });
      return false;
    },
    updateLayout(width, height, spreadMode = layoutOptions().spread ?? state.spreadMode, margin) {
      reflow(
        margin === undefined
          ? { ...layoutOptions(), width, height, spread: spreadMode }
          : { ...layoutOptions(), width, height, margin, spread: spreadMode },
      );
      return false;
    },
    setTheme(theme) {
      if (theme.backgroundColor !== undefined) state.bgColor = theme.backgroundColor ?? '#ffffff';
      if (theme.foregroundColor !== undefined) state.fgColor = theme.foregroundColor ?? undefined;
    },
    setTypography(typography) {
      if (typography.fontSize !== undefined)
        state.fontSizeOverride = typography.fontSize ?? undefined;
      if (typography.lineHeight !== undefined)
        state.lineHeightOverride = typography.lineHeight ?? undefined;
      if (typography.lineHeightForce !== undefined)
        state.lineHeightForce = typography.lineHeightForce;
      if (typography.fontFamily !== undefined) {
        state.fontFamilyOverride = typography.fontFamily ?? undefined;
      }
      if (typography.fontFamilyForce !== undefined)
        state.fontFamilyForce = typography.fontFamilyForce;
      reflow();
      return false;
    },
  };
}

function navigationMethods(
  state: BrowserReaderState,
): Pick<
  BrowserReaderMethodSurface,
  | 'getCanvasSize'
  | 'getLayoutGeometry'
  | 'findPage'
  | 'findSpread'
  | 'resolveTocEntry'
  | 'findActiveTocEntry'
  | 'navigateToLocator'
> {
  return {
    getCanvasSize(scale = 1) {
      const config = state.config;
      return {
        width: Math.round(config.viewportWidth * scale * state.dpr) / state.dpr,
        height: Math.round(config.viewportHeight * scale * state.dpr) / state.dpr,
      };
    },
    getLayoutGeometry() {
      return state.config;
    },
    findPage(entry) {
      return findRitoCoreWasmReaderTocTarget(state.tocTargets, entry)?.pageIndex;
    },
    findSpread(pageIndex) {
      return findRitoCoreWasmReaderSpreadContainingPage(browserReaderSpreads(state), pageIndex);
    },
    resolveTocEntry(entry) {
      const target = findRitoCoreWasmReaderTocTarget(state.tocTargets, entry);
      return target ? { pageIndex: target.pageIndex, spreadIndex: target.spreadIndex } : undefined;
    },
    findActiveTocEntry(pageIndex) {
      return findRitoCoreWasmReaderActiveTocEntry(state.tocTargets, pageIndex);
    },
    navigateToLocator(locator, signal) {
      return ensureBrowserReaderBoundedLocator(state, locator, signal);
    },
  };
}

function resourceMethods(
  state: BrowserReaderState,
): Pick<
  BrowserReaderMethodSurface,
  'search' | 'getChapterTextIndices' | 'getFootnotes' | 'getImageBlobUrl'
> {
  return {
    async search(query, searchOptions) {
      if (query.length === 0) return [];
      if ((await completeBrowserReaderBoundedSession(state)) !== true) return [];
      const capture = captureCommittedSourceRead(state);
      if (!capture) return [];
      const response = await readCapturedSource(state, capture, (worker, revision) =>
        worker.searchAtRevision(revision, {
          query,
          caseSensitive: searchOptions?.caseSensitive ?? false,
          wholeWord: searchOptions?.wholeWord ?? false,
        }),
      );
      if (!response) return [];
      if (response.revisionId !== capture.coreRevision.revisionId) {
        throw new Error('Reader search response does not match its revision request');
      }
      return response.results.map(toSearchResult);
    },
    getChapterTextIndices() {
      return state.chapterTextIndices;
    },
    getFootnotes() {
      return state.footnotes;
    },
    getImageBlobUrl(src) {
      return getImageObjectUrl(state, src);
    },
  };
}

function listenerMethods(
  state: BrowserReaderState,
): Pick<
  BrowserReaderMethodSurface,
  'onSpreadRendered' | 'onSpreadContentInvalidated' | 'onLayoutCommitted'
> {
  return {
    onSpreadRendered(cb) {
      state.spreadRenderedListeners.add(cb);
      return () => state.spreadRenderedListeners.delete(cb);
    },
    onSpreadContentInvalidated(cb) {
      state.spreadContentInvalidatedListeners.add(cb);
      return () => state.spreadContentInvalidatedListeners.delete(cb);
    },
    onLayoutCommitted(cb) {
      state.layoutCommittedListeners.add(cb);
      return () => state.layoutCommittedListeners.delete(cb);
    },
  };
}

function toSearchResult(result: CoreSearchResponse['results'][number]): SearchResult {
  return {
    pageIndex: result.pageIndex,
    range: {
      start: result.matchRange.start,
      end: result.matchRange.end,
    },
    context: result.matchRange.context,
    source:
      result.source.status === 'resolved'
        ? {
            status: 'resolved',
            href: result.source.href,
            sourceRange: {
              start: copyReaderSourcePoint(result.source.sourceRange.start),
              end: copyReaderSourcePoint(result.source.sourceRange.end),
            },
          }
        : {
            status: 'unavailable',
            reason: result.source.reason,
          },
  };
}
