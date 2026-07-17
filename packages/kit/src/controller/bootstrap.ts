import type { Reader } from '@ritojs/core';
import type { FrameDriver } from '../driver/frame-driver';
import { createTransitionDriver } from '../driver/transition-driver';
import type { ContentRenderer } from '../painter/buffer-pool';
import { createPageBufferPool } from '../painter/buffer-pool';
import { createDisplaySurface } from '../painter/display-surface';
import type { createDisposableCollection } from '../utils/disposable';
import { runDisposers } from '../utils/disposable';
import type { createEmitter } from '../utils/event-emitter';
import type { ConstructionOwner } from './construction-owner';
import { createCoordinatorState } from './core/index';
import { buildWiringDeps } from './core/wiring-deps';
import { createEngines } from './engines/index';
import { syncCanvasSize, type Internals } from './facade';
import { commitLayoutChange, publishPaginationChange } from './facade/layout-actions';
import { createPrimarySelectionDragNavigation } from './facade/selection-primary-drag';
import type { RuntimeComponents } from './facade/types';
import { createNavigation } from './navigation/index';
import { createPositionPersistence } from './position-persistence';
import { createPrerenderScheduler } from './prerender';
import {
  createRuntimeFrameParts,
  scheduleControllerPrerender,
  wireSettledEvents,
} from './runtime-frame';
import type { ControllerOptions, ReaderControllerEvents } from './types';
import {
  wireDomHelpers,
  wireEngineEvents,
  wirePositionTracker,
  wireSpreadRendered,
} from './wiring/index';

type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
type Disposables = ReturnType<typeof createDisposableCollection>;
type TransitionDriverInstance = ReturnType<typeof createTransitionDriver>;
type PageBufferPoolInstance = ReturnType<typeof createPageBufferPool>;

export interface ControllerBootstrap {
  readonly internals: Internals;
  readonly runtime: RuntimeComponents;
  readonly nav: ReturnType<typeof createNavigation>;
  readonly contentRenderer: ContentRenderer;
}

export function bootstrapRuntime(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ControllerOptions,
  emitter: Emitter,
  disposables: Disposables,
  construction: ConstructionOwner,
): ControllerBootstrap {
  construction.own(() => {
    disposables.disposeAll();
  });
  const { internals, runtime, contentRenderer } = createRuntimeComponents(
    reader,
    canvas,
    options,
    emitter,
    disposables,
    construction,
  );
  const nav = createRuntimeNavigation(
    internals,
    emitter,
    runtime.td,
    runtime.frameDriver,
    runtime.pool,
    contentRenderer,
  );
  const disposeNavigation = construction.own(() => {
    nav.dispose();
  });
  disposables.add(disposeNavigation);
  wireRuntimeEvents(internals, emitter, runtime, canvas, nav, contentRenderer, disposables);
  return { internals, runtime, nav, contentRenderer };
}

function createRuntimeComponents(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ControllerOptions,
  emitter: Emitter,
  disposables: Disposables,
  construction: ConstructionOwner,
): Omit<ControllerBootstrap, 'nav'> {
  const surface = createDisplaySurface(canvas);
  const pool = createOwnedPool(construction);
  const prerenderScheduler = createOwnedPrerenderScheduler(construction);
  const transitionDriver = createTransitionDriver(options.transition);
  const internals = createControllerInternals(reader, options);
  const disposeControllerEngines = construction.own(() => {
    disposeEngines(internals);
  });
  disposables.add(disposeControllerEngines);

  const { contentRenderer, frameDriver } = createRuntimeFrameParts(
    reader,
    internals,
    surface,
    pool,
    transitionDriver,
  );
  construction.own(() => {
    frameDriver.dispose();
  });
  const disposeSettledEvents = wireSettledEvents(
    internals,
    transitionDriver,
    pool,
    emitter,
    frameDriver,
    reader,
    contentRenderer,
    prerenderScheduler,
  );
  construction.own(disposeSettledEvents);
  const runtime: RuntimeComponents = {
    td: transitionDriver,
    frameDriver,
    pool,
    prerenderScheduler,
    disposeSettledEvents,
    surface,
  };
  return { internals, runtime, contentRenderer };
}

function createOwnedPool(construction: ConstructionOwner): PageBufferPoolInstance {
  const pool = createPageBufferPool();
  construction.own(() => {
    pool.dispose();
  });
  return pool;
}

function createOwnedPrerenderScheduler(construction: ConstructionOwner) {
  const scheduler = createPrerenderScheduler();
  construction.own(() => {
    scheduler.dispose();
  });
  return scheduler;
}

function createControllerInternals(reader: Reader, options: ControllerOptions): Internals {
  const coordState = createCoordinatorState();
  const engines = createEngines(reader, options, coordState);
  try {
    return {
      reader,
      currentSpread: 0,
      renderScale: options.renderScale ?? 1,
      options,
      engines,
      coordState,
      positionPersistence: createPositionPersistence(options.positionStorage),
      pendingPositionAction: undefined,
      restoreCompleted: false,
    };
  } catch (error: unknown) {
    const annotationStore = coordState.annotationStore;
    coordState.annotationStore = null;
    tryDisposeEngines(engines, annotationStore);
    throw error;
  }
}

function disposeEngines(internals: Internals): void {
  const { engines, coordState } = internals;
  const annotationStore = coordState.annotationStore;
  coordState.annotationStore = null;
  disposeEngineResources(engines, annotationStore);
}

function disposeEngineResources(
  engines: Internals['engines'],
  annotationStore: Internals['coordState']['annotationStore'],
): void {
  runDisposers([
    () => {
      engines.selection.dispose();
    },
    () => {
      engines.position?.dispose();
    },
    () => {
      annotationStore?.dispose();
    },
  ]);
}

function tryDisposeEngines(
  engines: Internals['engines'],
  annotationStore: Internals['coordState']['annotationStore'],
): void {
  try {
    disposeEngineResources(engines, annotationStore);
  } catch {
    // Preserve the construction error after best-effort cleanup.
  }
}

function createRuntimeNavigation(
  internals: Internals,
  emitter: Emitter,
  transitionDriver: TransitionDriverInstance,
  frameDriver: FrameDriver,
  pool: PageBufferPoolInstance,
  contentRenderer: ContentRenderer,
) {
  return createNavigation({
    getReader: () => internals.reader,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (index) => {
      internals.currentSpread = index;
    },
    getRenderScale: () => internals.renderScale,
    emitter,
    td: transitionDriver,
    frameDriver,
    pool,
    contentRenderer,
    onNavigationIntent: () => {
      internals.engines.position?.claimIntent();
    },
    onContentInteractionIntent: () => {
      internals.coordState.selectionProjectionTransfer = null;
      internals.coordState.contentInteractionGeneration += 1;
    },
    onNavigationCancelled: () => {
      internals.engines.position?.update(internals.currentSpread);
    },
    onPaginationChanged: () => {
      publishPaginationChange(internals, emitter, frameDriver);
    },
    beginSelectionProjectionTransfer: (targetSpreadIndex, gesture) => {
      const transfer = { targetSpreadIndex, gesture };
      internals.coordState.selectionProjectionTransfer = transfer;
      return () => {
        if (internals.coordState.selectionProjectionTransfer === transfer) {
          internals.coordState.selectionProjectionTransfer = null;
        }
      };
    },
  });
}

function wireRuntimeEvents(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
  canvas: HTMLCanvasElement,
  nav: ReturnType<typeof createNavigation>,
  contentRenderer: ContentRenderer,
  disposables: Disposables,
): void {
  const deps = buildWiringDeps(internals, emitter, runtime.frameDriver, canvas, nav, () => {
    syncCanvasSize(internals, runtime);
  });
  wireSpreadRendered(deps, disposables);
  if (typeof internals.reader.onLayoutCommitted === 'function') {
    disposables.add(
      internals.reader.onLayoutCommitted((activeSpreadIndex) => {
        commitLayoutChange(internals, emitter, runtime, undefined, activeSpreadIndex);
        nav.notifyLayoutCommitted();
        scheduleControllerPrerender(internals, runtime, contentRenderer);
      }),
    );
  }
  wireEngineEvents(deps, disposables);
  wirePositionTracker(deps, disposables);
  wireDomHelpers(deps, disposables, createPrimarySelectionDragNavigation(internals, canvas, nav));
}
