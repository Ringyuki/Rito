import type { Reader } from '@ritojs/core';
import type { SettledEvent } from '../driver/types';
import { createTransitionDriver } from '../driver/transition-driver';
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
import type { createNavigation } from './navigation/index';
import { createPositionPersistence } from './position-persistence';
import { createPrerenderScheduler } from './prerender';
import {
  createProvisionalTransitionRuntime,
  createRuntimeFrameParts,
  wireSettledEvents,
} from './runtime-frame';
import type { ProvisionalTransitionRuntime } from './runtime-frame';
import type { ControllerOptions, ReaderControllerEvents } from './types';

type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
type Disposables = ReturnType<typeof createDisposableCollection>;
type PageBufferPoolInstance = ReturnType<typeof createPageBufferPool>;

export interface RuntimeConstruction {
  readonly internals: Internals;
  readonly runtime: RuntimeComponents;
  readonly contentRenderer: ContentRenderer;
  readonly provisionalRuntime: ProvisionalTransitionRuntime;
  bindChapterLocalNavigation(nav: ReturnType<typeof createNavigation>): void;
}

export function createRuntimeComponents(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ControllerOptions,
  emitter: Emitter,
  disposables: Disposables,
  construction: ConstructionOwner,
): RuntimeConstruction {
  const parts = createOwnedRuntimeParts(reader, canvas, options, disposables, construction);
  const { internals, pool, prerenderScheduler, transitionDriver, contentRenderer, frameDriver } =
    parts;
  const provisionalRuntime = createProvisionalTransitionRuntime(
    internals,
    emitter,
    frameDriver,
    reader,
    pool,
    contentRenderer,
    prerenderScheduler,
    () => transitionDriver.isAnimating,
  );
  const chapterLocal = createChapterLocalRuntimeBinding();
  const disposeSettledEvents = wireSettledEvents(
    internals,
    transitionDriver,
    pool,
    emitter,
    frameDriver,
    reader,
    contentRenderer,
    prerenderScheduler,
    chapterLocal.handleSettled,
  );
  construction.own(disposeSettledEvents);
  const runtime = createRuntimeFacade(parts, disposeSettledEvents, chapterLocal);
  return {
    internals,
    runtime,
    contentRenderer,
    provisionalRuntime,
    bindChapterLocalNavigation: chapterLocal.bind,
  };
}

function createChapterLocalRuntimeBinding(): {
  readonly handleSettled: (event: SettledEvent) => boolean;
  readonly terminateForLayout: () => (() => void) | undefined;
  readonly refreshTheme: () => void;
  readonly bind: (nav: ReturnType<typeof createNavigation>) => void;
} {
  let handleSettled: ((event: SettledEvent) => boolean) | undefined;
  let terminateForLayout: (() => (() => void) | undefined) | undefined;
  let refreshTheme: (() => void) | undefined;
  return {
    handleSettled: (event) => handleSettled?.(event) ?? false,
    terminateForLayout: () => terminateForLayout?.(),
    refreshTheme: () => {
      refreshTheme?.();
    },
    bind: (nav) => {
      handleSettled = (event) => nav.handleTransitionSettled(event);
      terminateForLayout = () => nav.terminateChapterLocalForLayout();
      refreshTheme = () => {
        nav.refreshChapterLocalTheme();
      };
    },
  };
}

function createOwnedRuntimeParts(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ControllerOptions,
  disposables: Disposables,
  construction: ConstructionOwner,
) {
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
  chapterLocal: {
    readonly terminateForLayout: () => (() => void) | undefined;
    readonly refreshTheme: () => void;
  },
): RuntimeComponents {
  return {
    td: parts.transitionDriver,
    frameDriver: parts.frameDriver,
    pool: parts.pool,
    prerenderScheduler: parts.prerenderScheduler,
    disposeSettledEvents,
    surface: parts.surface,
    terminateChapterLocalForLayout: chapterLocal.terminateForLayout,
    refreshChapterLocalTheme: chapterLocal.refreshTheme,
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
