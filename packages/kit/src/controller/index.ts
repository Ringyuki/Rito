import type { Reader } from '@ritojs/core';
import { createDisposableCollection } from '../utils/disposable';
import { createEmitter } from '../utils/event-emitter';
import { bootstrapRuntime } from './bootstrap';
import { createConstructionOwner } from './construction-owner';
import { buildController, type Internals } from './facade';
import { requireRenderScale } from './facade/layout-actions';
import type { RuntimeComponents } from './facade/types';
import { createInteractionModeManager, detectDefaultMode } from './interaction-mode/index';
import type { createNavigation } from './navigation/index';
import { startInitialControllerFrame } from './runtime-frame';
import type { ControllerOptions, ReaderController, ReaderControllerEvents } from './types';
import { wireKeyboard } from './wiring/index';
import { wireKeyboardSelection } from './wiring/index';
import { wireTouchGestures } from './wiring/touch';

type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
type Disposables = ReturnType<typeof createDisposableCollection>;

export type {
  AddAnnotationInput,
  ControllerOptions,
  InteractionMode,
  ReaderController,
  ReaderControllerEvents,
  SelectionClientPoint,
  SelectionHandleDrag,
  SelectionHandleEdge,
  SelectionHandleState,
} from './types';

export function createController(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options?: ControllerOptions,
): ReaderController {
  const controllerOptions = options ?? {};
  requireRenderScale(controllerOptions.renderScale ?? 1);
  const construction = createConstructionOwner();
  try {
    return constructController(reader, canvas, controllerOptions, construction);
  } catch (error: unknown) {
    try {
      construction.rollback();
    } catch {
      // Preserve the construction error after best-effort cleanup.
    }
    throw error;
  }
}

function constructController(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ControllerOptions,
  construction: ReturnType<typeof createConstructionOwner>,
): ReaderController {
  const emitter = createEmitter<ReaderControllerEvents>();
  const disposables = createDisposableCollection();
  disposables.add(() => {
    emitter.dispose();
  });
  const { internals, runtime, nav, contentRenderer } = bootstrapRuntime(
    reader,
    canvas,
    options,
    emitter,
    disposables,
    construction,
  );
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
  const controller = buildController(
    internals,
    emitter,
    disposables,
    runtime,
    keyboard,
    modeManager,
    nav,
    canvas,
  );
  construction.commit();
  return controller;
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
        nav.nextSpread('keyboard');
      },
      prevSpread: () => {
        nav.prevSpread('keyboard');
      },
      goToSpread: (index) => {
        nav.goToSpread(index, 'keyboard');
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
  wireKeyboardSelection(internals, canvas, nav, emitter, keyboard, disposables);

  return { keyboard, modeManager };
}
