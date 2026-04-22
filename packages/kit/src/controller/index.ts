import type { Reader } from '@ritojs/core';

import { createDisplaySurface } from '../painter/display-surface';
import { createPageBufferPool } from '../painter/buffer-pool';
import { mergeOverlayLayers } from './overlay/merger';
import { buildOverlayData, buildAdjacentOverlayData } from './overlay/projection';
import { createTransitionDriver } from '../driver/transition-driver';
import { createFrameDriver } from '../driver/frame-driver';
import { createEmitter } from '../utils/event-emitter';
import { createDisposableCollection } from '../utils/disposable';
import { createCoordinatorState } from './core/index';
import { buildWiringDeps } from './core/wiring-deps';
import { createCoordinateMapper } from './geometry/coordinate-mapper';
import { createInteractionModeManager, detectDefaultMode } from './interaction-mode/index';
import { createNavigation } from './navigation/index';
import { createEngines } from './engines/index';
import { buildController, syncCanvasSize, type Internals } from './facade';
import { scheduleIdlePrerender } from './prerender';
import {
  wireDomHelpers,
  wireEngineEvents,
  wireKeyboard,
  wirePositionTracker,
  wireSpreadRendered,
} from './wiring/index';
import { wireTouchGestures } from './wiring/touch';
import type { ControllerOptions, ReaderController, ReaderControllerEvents } from './types';
import type { OverlayLayer } from '../painter/types';
import type { RuntimeComponents } from './facade/types';

type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
type Disposables = ReturnType<typeof createDisposableCollection>;
type TransitionDriverInstance = ReturnType<typeof createTransitionDriver>;
type PageBufferPoolInstance = ReturnType<typeof createPageBufferPool>;
type FrameDriverInstance = ReturnType<typeof createFrameDriver>;
type ContentRendererFn = (spreadIndex: number, ctx: OffscreenCanvasRenderingContext2D) => void;

interface RuntimeFrameParts {
  readonly contentRenderer: ContentRendererFn;
  readonly frameDriver: FrameDriverInstance;
}

export type {
  ReaderController,
  ReaderControllerEvents,
  ControllerOptions,
  InteractionMode,
  AddAnnotationInput,
} from './types';

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
  syncCanvasSize(internals, runtime);

  // Initial render via buffer pool
  runtime.pool.assignSlot('curr', 0);
  runtime.frameDriver.scheduleComposite();

  // Notify after first frame so coordinators build hitMaps etc.
  reader.notifyActiveSpread(0);

  return buildController(
    internals,
    emitter,
    disposables,
    runtime,
    kbd,
    mm,
    nav,
    opts,
    canvas,
    reader,
  );
}

function bootstrapRuntime(
  reader: Reader,
  canvas: HTMLCanvasElement,
  opts: ControllerOptions,
  emitter: Emitter,
  disposables: Disposables,
) {
  const surface = createDisplaySurface(canvas);
  const pool = createPageBufferPool();
  const td = createTransitionDriver(opts.transition);
  const coordState = createCoordinatorState();
  const engines = createEngines(reader, opts, coordState);

  const internals: Internals = {
    reader,
    currentSpread: 0,
    renderScale: opts.renderScale ?? 1,
    options: opts,
    engines,
    coordState,
  };

  const { contentRenderer, frameDriver } = createRuntimeFrameParts(
    reader,
    internals,
    surface,
    pool,
    td,
  );
  wireSettledEvents(internals, td, pool, emitter, frameDriver, reader, contentRenderer);
  const runtime: RuntimeComponents = { td, frameDriver, pool, surface };
  const nav = createRuntimeNavigation(internals, emitter, td, frameDriver, pool, contentRenderer);
  wireRuntimeEvents(internals, emitter, frameDriver, canvas, nav, disposables);

  return { internals, runtime, nav };
}

function createRuntimeFrameParts(
  reader: Reader,
  internals: Internals,
  surface: ReturnType<typeof createDisplaySurface>,
  pool: PageBufferPoolInstance,
  td: TransitionDriverInstance,
): RuntimeFrameParts {
  const contentRenderer = (spreadIndex: number, ctx: OffscreenCanvasRenderingContext2D): void => {
    reader.renderSpreadTo(spreadIndex, ctx);
  };
  const overlayProvider = buildOverlayProvider(
    internals,
    internals.engines,
    reader,
    internals.coordState,
  );
  const frameDriver = createFrameDriver({
    surface,
    pool,
    transitionDriver: td,
    contentRenderer,
    overlayProvider,
    getBackingRatio: () => reader.dpr * internals.renderScale,
  });
  return { contentRenderer, frameDriver };
}

function createRuntimeNavigation(
  internals: Internals,
  emitter: Emitter,
  td: TransitionDriverInstance,
  frameDriver: FrameDriverInstance,
  pool: PageBufferPoolInstance,
  contentRenderer: ContentRendererFn,
) {
  return createNavigation({
    getReader: () => internals.reader,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (index) => {
      internals.currentSpread = index;
    },
    getRenderScale: () => internals.renderScale,
    emitter,
    td,
    frameDriver,
    pool,
    contentRenderer,
  });
}

function wireRuntimeEvents(
  internals: Internals,
  emitter: Emitter,
  frameDriver: FrameDriverInstance,
  canvas: HTMLCanvasElement,
  nav: ReturnType<typeof createNavigation>,
  disposables: Disposables,
): void {
  const deps = buildWiringDeps(internals, emitter, frameDriver, canvas, nav);
  wireSpreadRendered(deps, disposables);
  wireEngineEvents(deps, disposables);
  wirePositionTracker(deps, disposables);
  wireDomHelpers(deps, disposables);
}

function buildOverlayProvider(
  internals: Internals,
  engines: Internals['engines'],
  reader: Reader,
  coordState: Internals['coordState'],
): (spreadIndex: number) => readonly OverlayLayer[] {
  return (spreadIndex) => {
    const spread = reader.spreads[spreadIndex];
    if (!spread) return [];

    const isCurrent = spreadIndex === internals.currentSpread;
    const mapper =
      isCurrent && coordState.mapper
        ? coordState.mapper
        : createCoordinateMapper(reader.getLayoutGeometry(), spread, internals.renderScale);

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
}

function wireSettledEvents(
  internals: Internals,
  td: TransitionDriverInstance,
  pool: PageBufferPoolInstance,
  emitter: Emitter,
  frameDriver: FrameDriverInstance,
  reader: Reader,
  contentRenderer: ContentRendererFn,
): void {
  td.onSettled((event) => {
    if (event.committed) {
      if (event.direction === 'forward') pool.rotateForward();
      else pool.rotateBackward();

      internals.currentSpread = event.targetSpread;

      scheduleIdlePrerender(
        () => internals.currentSpread,
        () => td.isAnimating,
        reader,
        pool,
        contentRenderer,
      );
    } else {
      // Gesture canceled or boundary elastic — revert state if it was changed.
      const outgoing = event.targetSpread;
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
}

function wireIntegrations(
  internals: Internals,
  runtime: RuntimeComponents,
  emitter: Emitter,
  nav: ReturnType<typeof createNavigation>,
  reader: Reader,
  canvas: HTMLCanvasElement,
  disposables: Disposables,
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
