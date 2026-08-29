import type { Reader } from '@ritojs/core';
import type { FrameDriver } from '../driver/frame-driver';
import type { TransitionDriver } from '../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../painter/buffer-pool';
import type { createDisposableCollection } from '../utils/disposable';
import type { createEmitter } from '../utils/event-emitter';
import type { ConstructionOwner } from './construction-owner';
import { commitCurrentSpread } from './core/current-spread';
import { buildWiringDeps } from './core/wiring-deps';
import { syncCanvasSize, type Internals } from './facade';
import { commitLayoutChange, publishPaginationChange } from './facade/layout-actions';
import { createPrimarySelectionDragNavigation } from './facade/selection-primary-drag';
import type { RuntimeComponents } from './facade/types';
import { createNavigation } from './navigation/index';
import { createRuntimeComponents } from './runtime-construction';
import { scheduleControllerPrerender } from './runtime-frame';
import type { ProvisionalTransitionRuntime } from './runtime-frame';
import type { ControllerOptions, ReaderControllerEvents } from './types';
import {
  wireDomHelpers,
  wireEngineEvents,
  wirePositionTracker,
  wireSpreadRendered,
} from './wiring/index';

type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
type Disposables = ReturnType<typeof createDisposableCollection>;

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
  const constructionParts = createRuntimeComponents(
    reader,
    canvas,
    options,
    emitter,
    disposables,
    construction,
  );
  const { internals, runtime, contentRenderer, provisionalRuntime } = constructionParts;
  const nav = createRuntimeNavigation(
    internals,
    emitter,
    runtime.td,
    runtime.frameDriver,
    runtime.pool,
    contentRenderer,
    provisionalRuntime,
  );
  constructionParts.bindChapterLocalNavigation(nav);
  const disposeNavigation = construction.own(() => {
    nav.dispose();
  });
  disposables.add(disposeNavigation);
  wireRuntimeEvents(internals, emitter, runtime, canvas, nav, contentRenderer, disposables);
  return { internals, runtime, nav, contentRenderer };
}

function createRuntimeNavigation(
  internals: Internals,
  emitter: Emitter,
  transitionDriver: TransitionDriver,
  frameDriver: FrameDriver,
  pool: PageBufferPool,
  contentRenderer: ContentRenderer,
  provisionalRuntime: ProvisionalTransitionRuntime,
) {
  return createNavigation({
    getReader: () => internals.reader,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (index, reason) => {
      commitCurrentSpread(internals, index, reason);
    },
    getRenderScale: () => internals.renderScale,
    emitter,
    td: transitionDriver,
    frameDriver,
    pool,
    contentRenderer,
    provisionalRuntime,
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
