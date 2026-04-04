import { createReader } from 'rito';
import type { Reader } from 'rito';
import { createSelectionEngine } from 'rito/selection';
import { createSearchEngine } from 'rito/search';
import type { SearchResult } from 'rito/search';
import { createAnnotationEngine } from 'rito/annotations';
import type { Annotation } from 'rito/annotations';
import { createPositionTracker } from 'rito/position';

import { createTransitionEngine } from '../transition/index';
import { createOverlayRenderer } from '../overlay/index';
import { createEmitter } from '../utils/event-emitter';
import { createDisposableCollection } from '../utils/disposable';
import { createCoordinatorState, type CoordinatorEngines } from './engine-coordinator';
import { createInteractionModeManager, detectDefaultMode } from './interaction-mode';
import { createNavigation } from './navigation';
import {
  wireDomHelpers,
  wireEngineEvents,
  wirePositionTracker,
  wireSpreadRendered,
} from './wiring';
import type {
  InteractionMode,
  ReaderController,
  ReaderControllerEvents,
  ReaderControllerOptions,
} from './types';

export type {
  ReaderController,
  ReaderControllerEvents,
  ReaderControllerOptions,
  InteractionMode,
} from './types';

interface Internals {
  reader: Reader | null;
  currentSpread: number;
  isLoaded: boolean;
  isLoading: boolean;
  options: ReaderControllerOptions;
  engines: CoordinatorEngines | null;
}

export function createReaderController(options: ReaderControllerOptions): ReaderController {
  const emitter = createEmitter<ReaderControllerEvents>();
  const disposables = createDisposableCollection();
  const transition = createTransitionEngine(options.transition);
  const overlay = createOverlayRenderer();
  const modeManager = createInteractionModeManager(detectDefaultMode());
  const coordState = createCoordinatorState();

  const internals: Internals = {
    reader: null,
    currentSpread: 0,
    isLoaded: false,
    isLoading: false,
    options,
    engines: null,
  };

  const nav = createNavigation({
    getReader: () => internals.reader,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i) => {
      internals.currentSpread = i;
    },
    emitter,
    transition,
  });

  transition.onSwipeCommit = (dir) => {
    if (dir === 'forward') nav.nextSpread();
    else nav.prevSpread();
  };

  return buildControllerObject(
    internals,
    emitter,
    disposables,
    transition,
    overlay,
    modeManager,
    coordState,
    nav,
  );
}

function buildControllerObject(
  internals: Internals,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  disposables: ReturnType<typeof createDisposableCollection>,
  transition: ReturnType<typeof createTransitionEngine>,
  overlay: ReturnType<typeof createOverlayRenderer>,
  modeManager: ReturnType<typeof createInteractionModeManager>,
  coordState: ReturnType<typeof createCoordinatorState>,
  nav: ReturnType<typeof createNavigation>,
): ReaderController {
  return {
    load: (data) =>
      loadEpub(data, internals, emitter, transition, overlay, disposables, coordState),
    mount(container): void {
      transition.mount(container);
      overlay.mount(container);
    },
    dispose(): void {
      disposables.disposeAll();
      overlay.dispose();
      transition.dispose();
      internals.reader?.dispose();
      internals.reader = null;
      internals.isLoaded = false;
    },

    get isLoaded() {
      return internals.isLoaded;
    },
    get isLoading() {
      return internals.isLoading;
    },
    get metadata() {
      return internals.reader?.metadata ?? null;
    },
    get toc() {
      return internals.reader?.toc ?? [];
    },
    get spreads() {
      return internals.reader?.spreads ?? [];
    },
    get pages() {
      return internals.reader?.pages ?? [];
    },
    get currentSpread() {
      return internals.currentSpread;
    },
    get totalSpreads() {
      return internals.reader?.totalSpreads ?? 0;
    },

    ...nav,

    resize(w, h): void {
      resizeReader(internals, emitter, w, h);
    },
    setSpreadMode(mode): void {
      changeSpreadMode(internals, emitter, mode);
    },
    setTheme(opts): void {
      internals.reader?.setTheme(opts);
    },
    setTypography(opts) {
      return internals.reader?.setTypography(opts) ?? false;
    },

    search(q): void {
      internals.engines?.search.search(q);
    },
    searchNext(): SearchResult | undefined {
      return internals.engines?.search.nextResult();
    },
    searchPrev(): SearchResult | undefined {
      return internals.engines?.search.prevResult();
    },
    clearSearch(): void {
      internals.engines?.search.clear();
    },
    get searchResults() {
      return internals.engines?.search.getResults() ?? [];
    },
    get searchActiveIndex() {
      return internals.engines?.search.getActiveIndex() ?? -1;
    },

    clearSelection(): void {
      internals.engines?.selection.clear();
    },
    get selectionText() {
      return internals.engines?.selection.getText() ?? '';
    },
    get selectionRange() {
      return internals.engines?.selection.getSelection() ?? null;
    },

    addAnnotation(input): Annotation | undefined {
      return addAnnotation(internals, input);
    },
    removeAnnotation(id) {
      return internals.engines?.annotation.remove(id) ?? false;
    },
    updateAnnotation(id, patch) {
      return internals.engines?.annotation.update(id, patch) ?? false;
    },
    get annotations() {
      return internals.engines?.annotation.getAll() ?? [];
    },

    restorePosition(): number | undefined {
      return restorePos(internals);
    },
    savePosition(): void {
      savePos(internals);
    },

    setInteractionMode(mode): void {
      modeManager.setMode(mode);
    },
    get interactionMode(): InteractionMode {
      return modeManager.mode;
    },
    configureTransition(opts): void {
      transition.configure(opts);
    },

    on: (event, handler) => emitter.on(event, handler),

    get reader() {
      return internals.reader;
    },
    get transitionEngine() {
      return transition;
    },
    get overlayRenderer() {
      return overlay;
    },
    get emitter() {
      return emitter;
    },
  };
}

async function loadEpub(
  data: ArrayBuffer,
  internals: Internals,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  transition: ReturnType<typeof createTransitionEngine>,
  overlay: ReturnType<typeof createOverlayRenderer>,
  disposables: ReturnType<typeof createDisposableCollection>,
  coordState: ReturnType<typeof createCoordinatorState>,
): Promise<void> {
  internals.isLoading = true;
  emitter.emit('loadStart', undefined);
  try {
    internals.reader?.dispose();
    disposables.disposeAll();
    const reader = await createReader(data, transition.mainCanvas, internals.options);
    internals.reader = reader;
    internals.isLoaded = true;
    internals.isLoading = false;
    internals.currentSpread = 0;
    internals.engines = createEngines(reader);
    wireAll(reader, internals, emitter, overlay, disposables, coordState, transition.mainCanvas);
    syncCanvasSize(reader, transition, overlay, internals.options);
    reader.renderSpread(0);
    emitter.emit('loadEnd', { success: true });
    emitter.emit('layoutChange', { spreads: reader.spreads, totalSpreads: reader.totalSpreads });
  } catch (err) {
    internals.isLoading = false;
    const msg = err instanceof Error ? err.message : String(err);
    emitter.emit('loadEnd', { success: false, error: msg });
    emitter.emit('error', { message: msg, source: 'load' });
  }
}

function createEngines(reader: Reader): CoordinatorEngines {
  const selection = createSelectionEngine();
  const search = createSearchEngine();
  const annotation = createAnnotationEngine();
  search.setPages(reader.pages);
  const position = createPositionTracker(reader.spreads, reader.pages, reader.chapterMap);
  return { selection, search, annotation, position };
}

function wireAll(
  reader: Reader,
  internals: Internals,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  overlay: ReturnType<typeof createOverlayRenderer>,
  disposables: ReturnType<typeof createDisposableCollection>,
  coordState: ReturnType<typeof createCoordinatorState>,
  canvas: HTMLCanvasElement,
): void {
  if (!internals.engines) return;
  const deps = {
    reader,
    engines: internals.engines,
    emitter,
    overlay,
    options: internals.options,
    coordState,
    canvas,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i: number) => {
      internals.currentSpread = i;
    },
  };
  wireSpreadRendered(deps, disposables);
  wireEngineEvents(deps, disposables);
  wirePositionTracker(deps, disposables);
  wireDomHelpers(deps, disposables);
}

function syncCanvasSize(
  reader: Reader,
  transition: ReturnType<typeof createTransitionEngine>,
  overlay: ReturnType<typeof createOverlayRenderer>,
  options: ReaderControllerOptions,
): void {
  const size = reader.getCanvasSize();
  const dpr =
    options.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  transition.setSize(size.width, size.height, dpr);
  overlay.setSize(size.width, size.height, dpr);
}

function resizeReader(
  internals: Internals,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  w: number,
  h: number,
): void {
  if (!internals.reader) return;
  internals.options = { ...internals.options, width: w, height: h };
  const changed = internals.reader.updateLayout(w, h);
  if (!changed) return;
  internals.currentSpread = Math.min(internals.currentSpread, internals.reader.totalSpreads - 1);
  emitter.emit('layoutChange', {
    spreads: internals.reader.spreads,
    totalSpreads: internals.reader.totalSpreads,
  });
  internals.reader.renderSpread(internals.currentSpread);
}

function changeSpreadMode(
  internals: Internals,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  mode: 'single' | 'double',
): void {
  if (!internals.reader) return;
  internals.options = { ...internals.options, spread: mode };
  internals.reader.setSpreadMode(mode);
  internals.currentSpread = Math.min(internals.currentSpread, internals.reader.totalSpreads - 1);
  emitter.emit('layoutChange', {
    spreads: internals.reader.spreads,
    totalSpreads: internals.reader.totalSpreads,
  });
  internals.reader.renderSpread(internals.currentSpread);
}

function addAnnotation(
  internals: Internals,
  input: Parameters<ReaderController['addAnnotation']>[0],
): Annotation | undefined {
  if (!internals.engines || !internals.reader) return undefined;
  const spread = internals.reader.spreads[internals.currentSpread];
  const pageIndex = spread?.left?.index ?? 0;
  return internals.engines.annotation.add({ ...input, pageIndex });
}

function restorePos(internals: Internals): number | undefined {
  const serialized = internals.options.positionStorage?.load() ?? null;
  if (!serialized || !internals.engines?.position) return undefined;
  return internals.engines.position.restore(serialized);
}

function savePos(internals: Internals): void {
  if (!internals.engines?.position) return;
  internals.options.positionStorage?.save(internals.engines.position.serialize());
}
