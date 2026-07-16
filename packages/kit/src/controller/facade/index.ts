import type { ReaderController } from '../types';
import type {
  Internals,
  Emitter,
  Disposables,
  Keyboard,
  ModeManager,
  Nav,
  RuntimeComponents,
} from './types';
import { buildLifecycle } from './lifecycle';
import { buildReaderProxies } from './reader-proxies';
import { buildLayoutActions } from './layout-actions';
import { buildSearchActions } from './search-actions';
import { buildSelectionAccessors } from './selection-accessors';
import { buildAnnotationActions } from './annotation-actions';
import { buildPositionActions } from './position-actions';
import { buildMisc } from './misc-actions';
import { buildNavigationActions } from './navigation-actions';
import { buildWiringDeps } from '../core/wiring-deps';

export type { Internals } from './types';
export { syncCanvasSize } from './lifecycle';

export function buildController(
  internals: Internals,
  emitter: Emitter,
  disposables: Disposables,
  runtime: RuntimeComponents,
  keyboard: Keyboard,
  modeManager: ModeManager,
  nav: Nav,
  canvas: HTMLCanvasElement,
): ReaderController {
  const controller = {} as ReaderController;
  const lifecycleDeps = buildWiringDeps(internals, emitter, runtime.frameDriver, canvas, nav);
  defineSlice(
    controller,
    buildLifecycle(disposables, runtime, lifecycleDeps),
    buildNavigationActions(nav),
    buildLayoutActions(internals, emitter, runtime),
    buildSearchActions(internals, emitter, nav, runtime),
    buildSelectionAccessors(internals, canvas),
    buildAnnotationActions(internals, emitter),
    buildPositionActions(internals, nav),
    buildMisc(emitter, modeManager, keyboard, (update) => {
      runtime.td.configure(update);
    }),
    buildReaderProxies(internals),
  );
  return controller;
}

function defineSlice(target: object, ...slices: readonly object[]): void {
  for (const slice of slices) {
    Object.defineProperties(target, Object.getOwnPropertyDescriptors(slice));
  }
}
