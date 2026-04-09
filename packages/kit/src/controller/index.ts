import type { Reader } from 'rito';

import { createTransitionEngine } from '../transition/index';
import { createOverlayRenderer } from '../overlay/index';
import { createEmitter } from '../utils/event-emitter';
import { createDisposableCollection } from '../utils/disposable';
import { createCoordinatorState } from './core/index';
import { createInteractionModeManager, detectDefaultMode } from './interaction-mode/index';
import { createNavigation } from './navigation/index';
import { createEngines } from './engines/index';
import { buildController, syncCanvasSize, type Internals } from './facade';
import { toSpreadContent } from './core/wiring-deps';
import {
  wireDomHelpers,
  wireEngineEvents,
  wireKeyboard,
  wirePositionTracker,
  wireSpreadRendered,
  wireUnifiedTouchHandler,
} from './wiring/index';
import { wireA11y } from './wiring/a11y';
import { dispatchClick } from './wiring/click-dispatch';
import type { ControllerOptions, ReaderController, ReaderControllerEvents } from './types';

export type {
  ReaderController,
  ReaderControllerEvents,
  ControllerOptions,
  InteractionMode,
  AddAnnotationInput,
} from './types';

/**
 * Enhance an existing Reader with interaction features:
 * transitions, overlays, selection, search, annotations, position tracking,
 * keyboard shortcuts, touch gestures, and optional accessibility mirror.
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
  const { internals, transition, overlay, modeManager, nav } = bootstrapRuntime(
    reader,
    canvas,
    opts,
    emitter,
    disposables,
  );

  const keyboard = wireIntegrations(
    internals,
    transition,
    modeManager,
    emitter,
    nav,
    reader,
    canvas,
    internals.coordState,
    disposables,
  );
  wireA11y(opts, transition, reader, disposables);

  // Auto-return to gesture mode when selection is cleared
  emitter.on('selectionChange', ({ range }) => {
    if (range === null && modeManager.mode === 'selection') {
      modeManager.setMode('gesture');
    }
  });

  syncCanvasSize(internals, transition, overlay);
  reader.renderSpread(0, internals.renderScale);

  return buildController(
    internals,
    emitter,
    disposables,
    transition,
    overlay,
    keyboard,
    modeManager,
    nav,
  );
}

function bootstrapRuntime(
  reader: Reader,
  canvas: HTMLCanvasElement,
  opts: ControllerOptions,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  disposables: ReturnType<typeof createDisposableCollection>,
) {
  const transition = createTransitionEngine(canvas, opts.transition);
  const overlay = createOverlayRenderer();
  const modeManager = createInteractionModeManager(detectDefaultMode());
  const coordState = createCoordinatorState();
  const engines = createEngines(reader, opts, coordState);

  const internals: Internals = {
    reader,
    currentSpread: 0,
    renderScale: 1,
    options: opts,
    engines,
    coordState,
  };

  transition.setNavigationContext({
    get currentSpread() {
      return internals.currentSpread;
    },
    get totalSpreads() {
      return internals.reader.totalSpreads;
    },
    renderSpread: (idx: number) => {
      internals.reader.renderSpread(idx, internals.renderScale);
    },
  });

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

  wireSwipeCommit(transition, internals, emitter);
  wireAll(reader, internals, emitter, overlay, disposables, coordState, canvas);

  return { internals, transition, overlay, modeManager, nav };
}

/**
 * Swipe commit: the transition engine already pre-rendered and animated.
 * Only update bookkeeping and emit events — do NOT call nav.goTo (that would double-animate).
 */
function wireSwipeCommit(
  transition: ReturnType<typeof createTransitionEngine>,
  internals: Internals,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
): void {
  transition.onSwipeCommit = (dir, targetSpreadIndex) => {
    internals.currentSpread = targetSpreadIndex;
    const spread = internals.reader.spreads[targetSpreadIndex];
    if (spread) {
      emitter.emit('spreadChange', { spreadIndex: targetSpreadIndex, spread });
    }
    emitter.emit('transitionEnd', { direction: dir });
  };
}

/** Wire touch gestures and keyboard shortcuts. Returns the KeyboardManager. */
function wireIntegrations(
  internals: Internals,
  transition: ReturnType<typeof createTransitionEngine>,
  modeManager: ReturnType<typeof createInteractionModeManager>,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  nav: ReturnType<typeof createNavigation>,
  reader: Reader,
  canvas: HTMLCanvasElement,
  coordState: ReturnType<typeof createCoordinatorState>,
  disposables: ReturnType<typeof createDisposableCollection>,
): ReturnType<typeof wireKeyboard> {
  wireTouchGestures(
    internals,
    transition,
    modeManager,
    emitter,
    reader,
    canvas,
    coordState,
    disposables,
  );

  const keyboard = wireKeyboard(
    {
      emitter,
      nextSpread: () => {
        nav.nextSpread();
      },
      prevSpread: () => {
        nav.prevSpread();
      },
      goToSpread: (i) => {
        nav.goToSpread(i);
      },
      getTotalSpreads: () => internals.reader.totalSpreads,
      searchNext: () => {
        internals.engines.search.nextResult();
      },
      searchPrev: () => {
        internals.engines.search.prevResult();
      },
      clearSearch: () => {
        internals.engines.search.clear();
      },
    },
    disposables,
  );

  return keyboard;
}

function wireTouchGestures(
  internals: Internals,
  transition: ReturnType<typeof createTransitionEngine>,
  modeManager: ReturnType<typeof createInteractionModeManager>,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  reader: Reader,
  canvas: HTMLCanvasElement,
  coordState: ReturnType<typeof createCoordinatorState>,
  disposables: ReturnType<typeof createDisposableCollection>,
): void {
  const wrapper = transition.mainCanvas.parentElement;
  if (!wrapper) return;

  const touchToContent = (touch: Touch) =>
    toSpreadContent(
      { clientX: touch.clientX, clientY: touch.clientY } as PointerEvent,
      canvas,
      coordState,
    );
  const wiringDeps = {
    reader,
    engines: internals.engines,
    emitter,
    overlay: undefined as never,
    options: internals.options,
    coordState,
    canvas,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i: number) => {
      internals.currentSpread = i;
    },
    getRenderScale: () => internals.renderScale,
  };
  const handleTap = (pos: { x: number; y: number }) => {
    dispatchClick(pos, wiringDeps);
  };
  wireUnifiedTouchHandler(
    wrapper,
    transition,
    internals.engines.selection,
    modeManager,
    touchToContent,
    handleTap,
    disposables,
  );
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
