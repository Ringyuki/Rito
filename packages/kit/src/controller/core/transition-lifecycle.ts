import type { TransitionFrame } from '../../driver/effects';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';

type Emitter = TypedEmitter<ReaderControllerEvents>;

type TransitionDirection = 'forward' | 'backward';

/** How a page turn ended: it landed on its target, went back, or was cut off. */
export type TransitionOutcome = 'committed' | 'cancelled' | 'interrupted';

/**
 * The one owner of a controller's `transitionStart` / `transitionProgress`
 * / `transitionEnd` events. At most one turn is visible at a time:
 * beginning another ends the open one as interrupted, and ending is a no-op
 * when nothing is open — so every start is answered by exactly one end,
 * whichever path got there, and progress is only reported in between.
 */
export interface TransitionLifecycle {
  readonly openDirection: TransitionDirection | null;
  begin(direction: TransitionDirection): void;
  /** Report a painted frame of the open turn: how far it has travelled, of what width. */
  progress(frame: Pick<TransitionFrame, 'dx' | 'width'>): void;
  end(outcome: TransitionOutcome): void;
}

const lifecycles = new WeakMap<Emitter, TransitionLifecycle>();

/** The lifecycle of the controller that owns `emitter`. */
export function transitionLifecycle(emitter: Emitter): TransitionLifecycle {
  let lifecycle = lifecycles.get(emitter);
  if (!lifecycle) {
    lifecycle = createTransitionLifecycle(emitter);
    lifecycles.set(emitter, lifecycle);
  }
  return lifecycle;
}

/**
 * Drops whatever turn is in flight without landing it (a relayout, a failed
 * chapter presentation) and reports it as interrupted. The only way the
 * controller resets its transition driver.
 */
export function abortTransition(td: TransitionDriver, emitter: Emitter): void {
  td.reset();
  transitionLifecycle(emitter).end('interrupted');
}

function createTransitionLifecycle(emitter: Emitter): TransitionLifecycle {
  let open: TransitionDirection | null = null;
  const lifecycle: TransitionLifecycle = {
    get openDirection() {
      return open;
    },
    begin(direction) {
      lifecycle.end('interrupted');
      open = direction;
      emitter.emit('transitionStart', { direction });
    },
    progress({ dx, width }) {
      if (open === null) return;
      emitter.emit('transitionProgress', {
        direction: open,
        progress: turnProgress(open, dx, width),
      });
    },
    end(outcome) {
      if (open === null) return;
      const direction = open;
      open = null;
      emitter.emit('transitionEnd', { direction, outcome });
    },
  };
  return lifecycle;
}

/** How far the page has moved toward the neighbour: 0 at rest, 1 on arrival. */
function turnProgress(direction: TransitionDirection, dx: number, width: number): number {
  if (width <= 0) return 0;
  const toward = direction === 'forward' ? -dx : dx;
  return Math.min(1, Math.max(0, toward / width));
}
