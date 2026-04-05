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
import {
  wireDomHelpers,
  wireEngineEvents,
  wirePositionTracker,
  wireSpreadRendered,
} from './wiring/index';
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
  const engines = createEngines(reader, opts, coordState);

  const internals: Internals = {
    reader,
    currentSpread: 0,
    renderScale: 1,
    options: opts,
    engines,
    coordState,
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
