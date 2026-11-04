import { holdKeyboardManagerInput } from '../../keyboard/input-state';
import type { ContentRenderer } from '../../painter/buffer-pool';
import { abortTransition } from '../core/transition-lifecycle';
import { scheduleControllerPrerender } from '../runtime-frame';
import { commitLayoutChange } from './layout-actions';
import type { MountSuspension } from './lifecycle';
import type {
  Emitter,
  Internals,
  Keyboard,
  Nav,
  RuntimeComponents,
  SuspensionSlice,
} from './types';

/** Hands the reader over to another view and takes it back (see `ReaderController.suspend`). */
export function buildSuspension(
  internals: Internals,
  emitter: Emitter,
  runtime: RuntimeComponents,
  nav: Nav,
  keyboard: Keyboard,
  mounting: MountSuspension,
  contentRenderer: ContentRenderer,
): SuspensionSlice {
  let releases: (() => void)[] = [];
  return {
    suspend(): void {
      if (internals.suspended || mounting.disposed) return;
      // What was under way ends here: a turn, a selection, a queued jump.
      nav.supersedeForPositionIntent();
      abortTransition(runtime.td, emitter);
      internals.engines.selection.clear();
      emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
      internals.suspended = true;
      runtime.prerenderScheduler.pause();
      releases = [
        runtime.frameDriver.suspend(),
        holdKeyboardManagerInput(keyboard),
        () => {
          runtime.prerenderScheduler.resume();
        },
      ];
      mounting.detach();
      runtime.pool.resize(1, 1, 1);
      runtime.surface.release();
    },
    resume(): void {
      if (!internals.suspended || mounting.disposed) return;
      internals.suspended = false;
      for (const release of releases) release();
      releases = [];
      // The layout the reader has now, taken up as if it had just committed.
      commitLayoutChange(internals, emitter, runtime, null, internals.reader.activeSpreadIndex);
      scheduleControllerPrerender(internals, runtime, contentRenderer);
      nav.notifyLayoutCommitted();
      mounting.attach();
    },
    get suspended() {
      return internals.suspended && !mounting.disposed;
    },
  };
}
