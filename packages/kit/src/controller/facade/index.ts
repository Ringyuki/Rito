import type { ReaderController } from '../types';
import type {
  Internals,
  Emitter,
  Disposables,
  Transition,
  Overlay,
  ModeManager,
  Nav,
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
  transition: Transition,
  overlay: Overlay,
  modeManager: ModeManager,
  nav: Nav,
): ReaderController {
  return {
    ...buildLifecycle(disposables, transition, overlay),
    ...buildReaderProxies(internals),
    ...nav,
    ...buildLayoutActions(internals, emitter, transition, overlay),
    ...buildSearchActions(internals, nav),
    ...buildSelectionAccessors(internals),
    ...buildAnnotationActions(internals),
    ...buildPositionActions(internals),
    ...buildMisc(emitter, modeManager, transition, overlay),
  };
}
