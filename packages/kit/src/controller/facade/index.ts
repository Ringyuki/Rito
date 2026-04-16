import type { Reader } from '@rito/core';
import type { ControllerOptions, ReaderController } from '../types';
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
  opts: ControllerOptions,
  canvas: HTMLCanvasElement,
  reader: Reader,
): ReaderController {
  return {
    ...buildLifecycle(disposables, runtime, internals.coordState, opts, canvas, reader),
    ...buildReaderProxies(internals),
    ...nav,
    ...buildLayoutActions(internals, emitter, runtime),
    ...buildSearchActions(internals, nav, runtime),
    ...buildSelectionAccessors(internals),
    ...buildAnnotationActions(internals),
    ...buildPositionActions(internals),
    ...buildMisc(emitter, modeManager, keyboard, (update) => {
      runtime.td.configure(update);
    }),
  };
}
