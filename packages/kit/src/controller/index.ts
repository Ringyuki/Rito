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
import {
  READER_DEFAULTS,
  type ControllerOptions,
  type InteractionMode,
  type ReaderController,
  type ReaderControllerEvents,
} from './types';

export type {
  ReaderController,
  ReaderControllerEvents,
  ControllerOptions,
  InteractionMode,
} from './types';

interface Internals {
  reader: Reader;
  currentSpread: number;
  renderScale: number;
  options: ControllerOptions;
  engines: CoordinatorEngines;
}

/**
 * Enhance an existing Reader with interaction features:
 * transitions, overlays, selection, search, annotations, position tracking.
 *
 * The Reader must already be created via `createReader()` from rito core.
 * Call `mount(container)` to inject the visual infrastructure into the DOM.
 */
export function createController(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options?: ControllerOptions,
): ReaderController {
  const opts = options ?? {};
  const emitter = createEmitter<ReaderControllerEvents>();
  const disposables = createDisposableCollection();
  const transition = createTransitionEngine(canvas, opts.transition);
  const overlay = createOverlayRenderer();
  const modeManager = createInteractionModeManager(detectDefaultMode());
  const coordState = createCoordinatorState();
  const engines = createEngines(reader, opts);

  const internals: Internals = {
    reader,
    currentSpread: 0,
    renderScale: 1,
    options: opts,
    engines,
  };

  const nav = createNavigation({
    getReader: () => internals.reader,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i) => {
      internals.currentSpread = i;
    },
    getRenderScale: () => internals.renderScale,
    emitter,
    transition,
  });

  transition.onSwipeCommit = (dir) => {
    if (dir === 'forward') nav.nextSpread();
    else nav.prevSpread();
  };

  wireAll(reader, internals, emitter, overlay, disposables, coordState, canvas);
  syncCanvasSize(internals, transition, overlay);
  reader.renderSpread(0, internals.renderScale);

  return buildController(internals, emitter, disposables, transition, overlay, modeManager, nav);
}

function createEngines(reader: Reader, opts: ControllerOptions): CoordinatorEngines {
  const selection = createSelectionEngine();
  const search = createSearchEngine();
  const annotation = createAnnotationEngine();
  search.setPages(reader.pages);
  if (opts.annotationStorage) void annotation.init(opts.annotationStorage);
  const position = createPositionTracker(reader.spreads, reader.pages, reader.chapterMap);
  return { selection, search, annotation, position };
}

function goToSearchResult(
  result: SearchResult,
  reader: Reader,
  nav: ReturnType<typeof createNavigation>,
): void {
  const spreadIdx = reader.findSpread(result.pageIndex);
  if (spreadIdx !== undefined) nav.goToSpread(spreadIdx);
}

function navigateToSearchIndex(
  search: ReturnType<typeof createSearchEngine>,
  targetIndex: number,
  reader: Reader,
  nav: ReturnType<typeof createNavigation>,
): void {
  const results = search.getResults();
  if (targetIndex < 0 || targetIndex >= results.length) return;
  // Step to the target index using next/prev
  const current = search.getActiveIndex();
  const total = results.length;
  if (current === targetIndex) {
    const result = results[targetIndex];
    if (result) goToSearchResult(result, reader, nav);
    return;
  }
  const fwd = (targetIndex - current + total) % total;
  const bwd = (current - targetIndex + total) % total;
  const step = fwd <= bwd ? 1 : -1;
  const move = step === 1 ? () => search.nextResult() : () => search.prevResult();
  let result: SearchResult | undefined;
  const steps = Math.min(fwd, bwd);
  for (let i = 0; i < steps; i++) result = move();
  if (result) goToSearchResult(result, reader, nav);
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
    getRenderScale: () => internals.renderScale,
  };
  wireSpreadRendered(deps, disposables);
  wireEngineEvents(deps, disposables);
  wirePositionTracker(deps, disposables);
  wireDomHelpers(deps, disposables);
}

function syncCanvasSize(
  internals: Internals,
  transition: ReturnType<typeof createTransitionEngine>,
  overlay: ReturnType<typeof createOverlayRenderer>,
): void {
  const size = internals.reader.getCanvasSize(internals.renderScale);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  transition.setSize(size.width, size.height, dpr);
  overlay.setSize(size.width, size.height, dpr);
}

function buildController(
  internals: Internals,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  disposables: ReturnType<typeof createDisposableCollection>,
  transition: ReturnType<typeof createTransitionEngine>,
  overlay: ReturnType<typeof createOverlayRenderer>,
  modeManager: ReturnType<typeof createInteractionModeManager>,
  nav: ReturnType<typeof createNavigation>,
): ReaderController {
  return {
    mount(container): void {
      transition.mount(container);
      // Mount overlay inside the transition wrapper so it's positioned relative to the canvas
      const wrapper = transition.mainCanvas.parentElement;
      if (wrapper) overlay.mount(wrapper);
    },
    dispose(): void {
      disposables.disposeAll();
      overlay.dispose();
      transition.dispose();
    },

    get reader() {
      return internals.reader;
    },
    get metadata() {
      return internals.reader.metadata;
    },
    get toc() {
      return internals.reader.toc;
    },
    get spreads() {
      return internals.reader.spreads;
    },
    get pages() {
      return internals.reader.pages;
    },
    get currentSpread() {
      return internals.currentSpread;
    },
    get totalSpreads() {
      return internals.reader.totalSpreads;
    },

    ...nav,

    resize(w, h): void {
      const changed = internals.reader.updateLayout(w, h);
      if (!changed) return;
      internals.currentSpread = Math.min(
        internals.currentSpread,
        internals.reader.totalSpreads - 1,
      );
      syncCanvasSize(internals, transition, overlay);
      emitter.emit('layoutChange', {
        spreads: internals.reader.spreads,
        totalSpreads: internals.reader.totalSpreads,
      });
      internals.reader.renderSpread(internals.currentSpread, internals.renderScale);
    },
    setSpreadMode(mode): void {
      internals.reader.setSpreadMode(mode);
      internals.currentSpread = Math.min(
        internals.currentSpread,
        internals.reader.totalSpreads - 1,
      );
      syncCanvasSize(internals, transition, overlay);
      emitter.emit('layoutChange', {
        spreads: internals.reader.spreads,
        totalSpreads: internals.reader.totalSpreads,
      });
      internals.reader.renderSpread(internals.currentSpread, internals.renderScale);
    },
    setTheme(opts): void {
      internals.reader.setTheme(opts);
    },
    setTypography(opts) {
      return internals.reader.setTypography(opts);
    },

    setRenderScale(scale): void {
      if (scale === internals.renderScale) return;
      internals.renderScale = scale;
      syncCanvasSize(internals, transition, overlay);
      internals.reader.renderSpread(internals.currentSpread, scale);
    },
    get renderScale() {
      return internals.renderScale;
    },

    search(q): void {
      internals.engines.search.search(q);
    },
    searchNext(): SearchResult | undefined {
      const result = internals.engines.search.nextResult();
      if (result) goToSearchResult(result, internals.reader, nav);
      return result;
    },
    searchPrev(): SearchResult | undefined {
      const result = internals.engines.search.prevResult();
      if (result) goToSearchResult(result, internals.reader, nav);
      return result;
    },
    goToSearchResult(targetIndex): void {
      navigateToSearchIndex(internals.engines.search, targetIndex, internals.reader, nav);
    },
    clearSearch(): void {
      internals.engines.search.clear();
    },
    get searchResults() {
      return internals.engines.search.getResults();
    },
    get searchActiveIndex() {
      return internals.engines.search.getActiveIndex();
    },

    clearSelection(): void {
      internals.engines.selection.clear();
    },
    get selectionText() {
      return internals.engines.selection.getText();
    },
    get selectionRange() {
      return internals.engines.selection.getSelection();
    },

    addAnnotation(input): Annotation | undefined {
      const pageIndex = resolveSelectionPageIndex(internals);
      removeOverlapping(internals.engines.annotation, pageIndex, input.range);
      const ann = internals.engines.annotation.add({ ...input, pageIndex });
      void internals.engines.annotation.persist();
      return ann;
    },
    removeAnnotation(id) {
      const ok = internals.engines.annotation.remove(id);
      if (ok) void internals.engines.annotation.persist();
      return ok;
    },
    updateAnnotation(id, patch) {
      const ok = internals.engines.annotation.update(id, patch);
      if (ok) void internals.engines.annotation.persist();
      return ok;
    },
    get annotations() {
      return internals.engines.annotation.getAll();
    },

    restorePosition(): number | undefined {
      const s = internals.options.positionStorage?.load() ?? null;
      if (!s || !internals.engines.position) return undefined;
      return internals.engines.position.restore(s);
    },
    savePosition(): void {
      if (!internals.engines.position) return;
      internals.options.positionStorage?.save(internals.engines.position.serialize());
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

/** Determine which page the current selection is on from selection rect positions. */
function resolveSelectionPageIndex(internals: Internals): number {
  const spread = internals.reader.spreads[internals.currentSpread];
  if (!spread) return 0;
  if (!spread.right) return spread.left?.index ?? 0;

  const rects = internals.engines.selection.getRects();
  if (rects.length === 0) return spread.left?.index ?? 0;

  const firstRect = rects[0];
  if (!firstRect) return spread.left?.index ?? 0;

  const size = internals.reader.getCanvasSize();
  const margin = internals.options.margin ?? READER_DEFAULTS.margin;
  const gap = internals.options.spreadGap ?? READER_DEFAULTS.spreadGap;
  const pageWidth = (size.width - gap) / 2;
  const contentWidth = pageWidth - 2 * margin;

  return firstRect.x > contentWidth ? spread.right.index : (spread.left?.index ?? 0);
}

/** Remove existing annotations that overlap with the given range on the same page. */
function removeOverlapping(
  engine: ReturnType<typeof createAnnotationEngine>,
  pageIndex: number,
  range: Parameters<ReaderController['addAnnotation']>[0]['range'],
): void {
  for (const ann of engine.getForPage(pageIndex)) {
    if (rangesOverlap(ann.range, range)) engine.remove(ann.id);
  }
}

interface Pos {
  blockIndex: number;
  lineIndex: number;
  charIndex: number;
}

function rangesOverlap(a: { start: Pos; end: Pos }, b: { start: Pos; end: Pos }): boolean {
  return posLe(a.start, b.end) && posLe(b.start, a.end);
}

function posLe(a: Pos, b: Pos): boolean {
  if (a.blockIndex !== b.blockIndex) return a.blockIndex < b.blockIndex;
  if (a.lineIndex !== b.lineIndex) return a.lineIndex < b.lineIndex;
  return a.charIndex <= b.charIndex;
}
