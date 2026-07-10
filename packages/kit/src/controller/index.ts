import type { Reader } from '@ritojs/core/web';

import { createDisplaySurface } from '../painter/display-surface';
import { createPageBufferPool } from '../painter/buffer-pool';
import { createTransitionDriver } from '../driver/transition-driver';
import { createEmitter } from '../utils/event-emitter';
import { createDisposableCollection } from '../utils/disposable';
import { createCoordinatorState } from './core/index';
import { buildWiringDeps } from './core/wiring-deps';
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
import type { RuntimeComponents } from './facade/types';
import { createRuntimeFrameParts, type RuntimeFrameParts } from './runtime-frame';

type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
type Disposables = ReturnType<typeof createDisposableCollection>;
type TransitionDriverInstance = ReturnType<typeof createTransitionDriver>;
type PageBufferPoolInstance = ReturnType<typeof createPageBufferPool>;
type FrameDriverInstance = RuntimeFrameParts['frameDriver'];
type ContentRendererFn = RuntimeFrameParts['contentRenderer'];

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
  try {
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

    runtime.pool.assignSlot('curr', 0);
    runtime.frameDriver.scheduleComposite();
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
    restoreCompleted: false,
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
