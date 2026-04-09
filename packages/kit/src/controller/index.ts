import type { Reader } from 'rito';

import { createDisplaySurface } from '../painter/display-surface';
import { createPageBufferPool } from '../painter/buffer-pool';
import { mergeOverlayLayers } from './overlay/merger';
import { buildOverlayData, buildAdjacentOverlayData } from './overlay/projection';
import { createTransitionDriver } from '../driver/transition-driver';
import { createFrameDriver } from '../driver/frame-driver';
import { createEmitter } from '../utils/event-emitter';
import { createDisposableCollection } from '../utils/disposable';
import { createCoordinatorState } from './core/index';
import { createCoordinateMapper } from './geometry/coordinate-mapper';
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
import type { OverlayLayer } from '../painter/types';
import type { RuntimeComponents } from './facade/types';
import type { GestureDeps } from './wiring/gesture';

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
 * Call `mount(container)` to inject the display canvas into the DOM.
 */
export function createController(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options?: ControllerOptions,
): ReaderController {
  const opts = options ?? {};
  const emitter = createEmitter<ReaderControllerEvents>();
  const disposables = createDisposableCollection();

  const { internals, runtime, nav } = bootstrapRuntime(reader, canvas, opts, emitter, disposables);

  const { keyboard: kbd, modeManager: mm } = wireIntegrations(
    internals,
    runtime,
    emitter,
    nav,
    reader,
    canvas,
    disposables,
  );
  wireA11y(opts, canvas, reader, disposables);

  syncCanvasSize(internals, runtime);

  // Initial render via buffer pool
  runtime.pool.assignSlot('curr', 0);
  runtime.frameDriver.scheduleComposite();

  // Notify after first frame so coordinators build hitMaps etc.
  reader.notifyActiveSpread(0);

  return buildController(internals, emitter, disposables, runtime, kbd, mm, nav);
}

function bootstrapRuntime(
  reader: Reader,
  canvas: HTMLCanvasElement,
  opts: ControllerOptions,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  disposables: ReturnType<typeof createDisposableCollection>,
) {
  const surface = createDisplaySurface(canvas);
  const pool = createPageBufferPool();
  const td = createTransitionDriver(opts.transition);
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

  const contentRenderer = (spreadIndex: number, ctx: OffscreenCanvasRenderingContext2D): void => {
    reader.renderSpreadTo(spreadIndex, ctx);
  };

  const overlayProvider = (spreadIndex: number): readonly OverlayLayer[] => {
    const spread = reader.spreads[spreadIndex];
    if (!spread) return [];

    const isCurrent = spreadIndex === internals.currentSpread;
    const mapper =
      isCurrent && coordState.mapper
        ? coordState.mapper
        : createCoordinateMapper(reader.getLayoutGeometry(), spread, internals.renderScale);

    // For current spread: use live coordState (has hitMaps, annotations).
    // For adjacent spreads: build ephemeral hitMaps + resolve annotations on the fly,
    // so search highlights and annotations are visible during page-turn animation.
    const data = isCurrent
      ? buildOverlayData(spread, engines, reader, coordState, mapper)
      : buildAdjacentOverlayData(spread, engines, reader, coordState, mapper);

    return mergeOverlayLayers(
      data.selectionRects,
      data.searchRects,
      data.activeSearchRects,
      data.annotationLayers,
    );
  };

  const getBackingRatio = (): number => {
    return reader.dpr * internals.renderScale;
  };

  const frameDriver = createFrameDriver({
    surface,
    pool,
    transitionDriver: td,
    contentRenderer,
    overlayProvider,
    getBackingRatio,
  });

  // Wire transition settled events
  td.onSettled((event) => {
    if (event.committed) {
      const dir = event.direction;
      if (dir === 'forward') pool.rotateForward();
      else pool.rotateBackward();

      // Update currentSpread (idempotent for goToSpread, essential for gesture commits).
      // Do NOT re-emit spreadChange — goToSpread already emitted it at navigation start.
      internals.currentSpread = event.targetSpread;

      // Rebuild coordinator after rotation (hitMaps, mapper, annotations).
      reader.notifyActiveSpread(event.targetSpread);
      scheduleIdlePrerender(
        () => internals.currentSpread,
        () => td.isAnimating,
        reader,
        pool,
        contentRenderer,
      );
    } else {
      // Gesture canceled or boundary elastic — revert state if it was changed.
      // goToSpread sets currentSpread eagerly; on cancel we must undo.
      const outgoing = event.targetSpread; // = outgoingSpread for cancel
      if (internals.currentSpread !== outgoing) {
        internals.currentSpread = outgoing;
        reader.notifyActiveSpread(outgoing);
        const spread = reader.spreads[outgoing];
        if (spread) emitter.emit('spreadChange', { spreadIndex: outgoing, spread });
      }
    }
    emitter.emit('transitionEnd', { direction: event.direction });
    frameDriver.scheduleComposite();
  });

  const runtime: RuntimeComponents = { td, frameDriver, pool, surface };

  const nav = createNavigation({
    getReader: () => internals.reader,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i) => {
      internals.currentSpread = i;
    },
    getRenderScale: () => internals.renderScale,
    emitter,
    td,
    frameDriver,
    pool,
    contentRenderer,
  });

  wireAll(reader, internals, emitter, frameDriver, disposables, coordState, canvas, nav);

  return { internals, runtime, nav };
}

function wireIntegrations(
  internals: Internals,
  runtime: RuntimeComponents,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  nav: ReturnType<typeof createNavigation>,
  reader: Reader,
  canvas: HTMLCanvasElement,
  disposables: ReturnType<typeof createDisposableCollection>,
) {
  const mm = createInteractionModeManager(detectDefaultMode());

  wireTouchGestures(internals, runtime, mm, emitter, nav, reader, canvas, disposables);

  const kbd = wireKeyboard(
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
      searchNext: () => internals.engines.search.nextResult(),
      searchPrev: () => internals.engines.search.prevResult(),
      clearSearch: () => {
        internals.engines.search.clear();
      },
    },
    disposables,
  );

  return { keyboard: kbd, modeManager: mm };
}

function wireTouchGestures(
  internals: Internals,
  runtime: RuntimeComponents,
  modeManager: ReturnType<typeof createInteractionModeManager>,
  emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>,
  nav: ReturnType<typeof createNavigation>,
  reader: Reader,
  canvas: HTMLCanvasElement,
  disposables: ReturnType<typeof createDisposableCollection>,
): void {
  const touchToContent = (touch: Touch) =>
    toSpreadContent(
      { clientX: touch.clientX, clientY: touch.clientY } as PointerEvent,
      canvas,
      internals.coordState,
    );

  const gestureDeps: GestureDeps = {
    td: runtime.td,
    frameDriver: runtime.frameDriver,
    goToSpread: (i: number) => {
      nav.goToSpread(i);
    },
    getCurrentSpread: () => internals.currentSpread,
    getTotalSpreads: () => reader.totalSpreads,
    commitPendingTransition: () => {
      if (runtime.td.isAnimating) {
        runtime.td.forceSettle();
      }
    },
  };

  const wiringDeps = {
    reader,
    engines: internals.engines,
    emitter,
    frameDriver: runtime.frameDriver,
    options: internals.options,
    coordState: internals.coordState,
    canvas,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i: number) => {
      internals.currentSpread = i;
    },
    getRenderScale: () => internals.renderScale,
    goToSpread: (i: number) => {
      nav.goToSpread(i);
    },
  };

  const handleTap = (pos: { x: number; y: number }) => {
    dispatchClick(pos, wiringDeps);
  };

  wireUnifiedTouchHandler(
    canvas,
    gestureDeps,
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
  frameDriver: ReturnType<typeof createFrameDriver>,
  disposables: ReturnType<typeof createDisposableCollection>,
  coordState: ReturnType<typeof createCoordinatorState>,
  canvas: HTMLCanvasElement,
  nav: ReturnType<typeof createNavigation>,
): void {
  const deps = {
    reader,
    engines: internals.engines,
    emitter,
    frameDriver,
    options: internals.options,
    coordState,
    canvas,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i: number) => {
      internals.currentSpread = i;
    },
    getRenderScale: () => internals.renderScale,
    goToSpread: (i: number) => {
      nav.goToSpread(i);
    },
  };
  wireSpreadRendered(deps, disposables);
  wireEngineEvents(deps, disposables);
  wirePositionTracker(deps, disposables);
  wireDomHelpers(deps, disposables);
}

/**
 * Schedule prerendering of adjacent spreads using requestIdleCallback.
 * Falls back to setTimeout if rIC is unavailable.
 *
 * Uses a live getCurrentSpread getter so the callback always reads the
 * current spread at execution time, not the value captured at scheduling time.
 */
function scheduleIdlePrerender(
  getCurrentSpread: () => number,
  isAnimating: () => boolean,
  reader: Reader,
  pool: ReturnType<typeof createPageBufferPool>,
  contentRenderer: (spreadIndex: number, ctx: OffscreenCanvasRenderingContext2D) => void,
): void {
  const schedule =
    typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 1);

  schedule(() => {
    // Skip if a navigation is in progress — goToSpread has already set up
    // the incoming slot, and overwriting it with prerender data would corrupt it.
    if (isAnimating()) return;

    const cs = getCurrentSpread();
    const total = reader.totalSpreads;
    if (cs + 1 < total) {
      pool.assignSlot('next', cs + 1);
      pool.ensureContent('next', contentRenderer);
    }
    if (cs - 1 >= 0) {
      pool.assignSlot('prev', cs - 1);
      pool.ensureContent('prev', contentRenderer);
    }
  });
}
