import type { Reader } from '@ritojs/core';
import type { FrameDriver } from '../driver/frame-driver';
import { createTransitionDriver } from '../driver/transition-driver';
import type { ContentRenderer } from '../painter/buffer-pool';
import { createPageBufferPool } from '../painter/buffer-pool';
import { createDisplaySurface } from '../painter/display-surface';
import { createDisposableCollection } from '../utils/disposable';
import { createEmitter } from '../utils/event-emitter';
import { createCoordinatorState } from './core/index';
import { buildWiringDeps } from './core/wiring-deps';
import { createEngines } from './engines/index';
import { buildController, syncCanvasSize, type Internals } from './facade';
import {
  commitLayoutChange,
  publishPaginationChange,
  requireRenderScale,
} from './facade/layout-actions';
import type { RuntimeComponents } from './facade/types';
import { createInteractionModeManager, detectDefaultMode } from './interaction-mode/index';
import { createNavigation } from './navigation/index';
import {
  createRuntimeFrameParts,
  scheduleControllerPrerender,
  startInitialControllerFrame,
  wireSettledEvents,
} from './runtime-frame';
import type { ControllerOptions, ReaderController, ReaderControllerEvents } from './types';
import {
  wireDomHelpers,
  wireEngineEvents,
  wireKeyboard,
  wirePositionTracker,
  wireSpreadRendered,
} from './wiring/index';
import { createPositionPersistence } from './position-persistence';
import { wireTouchGestures } from './wiring/touch';

type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
type Disposables = ReturnType<typeof createDisposableCollection>;
type TransitionDriverInstance = ReturnType<typeof createTransitionDriver>;
type PageBufferPoolInstance = ReturnType<typeof createPageBufferPool>;

export type {
  AddAnnotationInput,
  ControllerOptions,
  InteractionMode,
  ReaderController,
  ReaderControllerEvents,
} from './types';

export function createController(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options?: ControllerOptions,
): ReaderController {
  const controllerOptions = options ?? {};
  requireRenderScale(controllerOptions.renderScale ?? 1);
  const emitter = createEmitter<ReaderControllerEvents>();
  const disposables = createDisposableCollection();
  const { internals, runtime, nav, contentRenderer } = bootstrapRuntime(
    reader,
    canvas,
    controllerOptions,
    emitter,
    disposables,
  );

  try {
    const { keyboard, modeManager } = wireIntegrations(
      internals,
      runtime,
      emitter,
      nav,
      reader,
      canvas,
      disposables,
    );
    startInitialControllerFrame(internals, runtime, reader, contentRenderer);
    return buildController(
      internals,
      emitter,
      disposables,
      runtime,
      keyboard,
      modeManager,
      nav,
      canvas,
    );
  } catch (error: unknown) {
    runtime.frameDriver.dispose();
    try {
      disposables.disposeAll();
    } catch {
      // Preserve the construction error after best-effort cleanup.
    }
    throw error;
  }
}

function bootstrapRuntime(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ControllerOptions,
  emitter: Emitter,
  disposables: Disposables,
) {
  const surface = createDisplaySurface(canvas);
  const pool = createPageBufferPool();
  const transitionDriver = createTransitionDriver(options.transition);
  const internals = createControllerInternals(reader, options);

  const { contentRenderer, frameDriver } = createRuntimeFrameParts(
    reader,
    internals,
    surface,
    pool,
    transitionDriver,
  );
  wireSettledEvents(
    internals,
    transitionDriver,
    pool,
    emitter,
    frameDriver,
    reader,
    contentRenderer,
  );
  const runtime: RuntimeComponents = { td: transitionDriver, frameDriver, pool, surface };
  const nav = createRuntimeNavigation(
    internals,
    emitter,
    transitionDriver,
    frameDriver,
    pool,
    contentRenderer,
  );
  wireRuntimeEvents(internals, emitter, runtime, canvas, nav, contentRenderer, disposables);
  return { internals, runtime, nav, contentRenderer };
}

function createControllerInternals(reader: Reader, options: ControllerOptions): Internals {
  const coordState = createCoordinatorState();
  return {
    reader,
    currentSpread: 0,
    renderScale: options.renderScale ?? 1,
    options,
    engines: createEngines(reader, options, coordState),
    coordState,
    positionPersistence: createPositionPersistence(options.positionStorage),
    pendingPositionAction: undefined,
    restoreCompleted: false,
  };
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
    onNavigationCancelled: () => {
      internals.engines.position?.update(internals.currentSpread);
    },
    onPaginationChanged: () => {
      publishPaginationChange(internals, emitter, frameDriver);
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
  disposables.add(() => {
    nav.dispose();
  });
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
  wireDomHelpers(deps, disposables);
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
  const modeManager = createInteractionModeManager(detectDefaultMode());
  wireTouchGestures(internals, runtime, modeManager, emitter, nav, reader, canvas, disposables);

  const keyboard = wireKeyboard(
    {
      emitter,
      nextSpread: () => {
        nav.nextSpread();
      },
      prevSpread: () => {
        nav.prevSpread();
      },
      goToSpread: (index) => {
        nav.goToSpread(index);
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

  return { keyboard, modeManager };
}
