import type { Reader } from '@ritojs/core';
import { createTransitionDriver, type TransitionDriver } from '../driver/transition-driver';
import type { ContentRenderer } from '../painter/buffer-pool';
import { createPageBufferPool } from '../painter/buffer-pool';
import { createDisplaySurface } from '../painter/display-surface';
import type { createDisposableCollection } from '../utils/disposable';
import { runDisposers } from '../utils/disposable';
import type { createEmitter } from '../utils/event-emitter';
import type { ConstructionOwner } from './construction-owner';
import { createCoordinatorState } from './core/index';
import { createEngines } from './engines/index';
import type { Internals } from './facade';
import type { RuntimeComponents } from './facade/types';
import { createPositionPersistence } from './position-persistence';
import { createPrerenderScheduler } from './prerender';
import { createRuntimeFrameParts, wireSettledEvents } from './runtime-frame';
import type { ControllerOptions, ReaderControllerEvents } from './types';

type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
type Disposables = ReturnType<typeof createDisposableCollection>;
type PageBufferPoolInstance = ReturnType<typeof createPageBufferPool>;

export interface RuntimeConstruction {
  readonly internals: Internals;
  readonly runtime: RuntimeComponents;
  readonly contentRenderer: ContentRenderer;
}

export function createRuntimeComponents(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ControllerOptions,
  emitter: Emitter,
  disposables: Disposables,
  construction: ConstructionOwner,
): RuntimeConstruction {
  const parts = createOwnedRuntimeParts(
    reader,
    canvas,
    options,
    emitter,
    disposables,
    construction,
  );
  const { internals, pool, prerenderScheduler, transitionDriver, contentRenderer, frameDriver } =
    parts;
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
  const runtime = createRuntimeFacade(parts, disposeSettledEvents);
  return { internals, runtime, contentRenderer };
}

function createOwnedRuntimeParts(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ControllerOptions,
  emitter: Emitter,
  disposables: Disposables,
  construction: ConstructionOwner,
) {
  const surface = createDisplaySurface(canvas);
  const pool = createOwnedPool(construction);
  const prerenderScheduler = createOwnedPrerenderScheduler(construction);
  const transitionDriver = createTransitionDriver(options.transition);
  disposables.add(construction.own(followReducedMotion(transitionDriver)));
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
    emitter,
  );
  construction.own(() => {
    frameDriver.dispose();
  });
  return {
    internals,
    surface,
    pool,
    prerenderScheduler,
    transitionDriver,
    contentRenderer,
    frameDriver,
  };
}

function createRuntimeFacade(
  parts: ReturnType<typeof createOwnedRuntimeParts>,
  disposeSettledEvents: () => void,
): RuntimeComponents {
  return {
    td: parts.transitionDriver,
    frameDriver: parts.frameDriver,
    pool: parts.pool,
    prerenderScheduler: parts.prerenderScheduler,
    disposeSettledEvents,
    surface: parts.surface,
  };
}

/**
 * Keeps the driver told whether the system asks for reduced motion, so
 * turns cross-fade instead of moving while it does. Returns the unsubscribe.
 */
function followReducedMotion(td: TransitionDriver): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  const sync = (): void => {
    td.reducedMotion = query.matches;
  };
  sync();
  query.addEventListener('change', sync);
  return () => {
    query.removeEventListener('change', sync);
  };
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
      currentSpread: initialActiveSpread(reader),
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

function initialActiveSpread(reader: Reader): number {
  const active: unknown = (reader as { readonly activeSpreadIndex?: unknown }).activeSpreadIndex;
  if (typeof active !== 'number' || !Number.isSafeInteger(active)) return 0;
  const lastSpread =
    Number.isSafeInteger(reader.totalSpreads) && reader.totalSpreads > 0
      ? reader.totalSpreads - 1
      : 0;
  return Math.max(0, Math.min(active, lastSpread));
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
