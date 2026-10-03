import type { TransitionDriver } from '../../driver/transition-driver';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';

type Emitter = TypedEmitter<ReaderControllerEvents>;

type TransitionDirection = 'forward' | 'backward';

/** How a page turn ended: it landed on its target, went back, or was cut off. */
export type TransitionOutcome = 'committed' | 'cancelled' | 'interrupted';

/**
 * The one owner of a controller's `transitionStart` / `transitionEnd`
 * events. At most one turn is visible at a time: beginning another ends the
 * open one as interrupted, and ending is a no-op when nothing is open — so
 * every start is answered by exactly one end, whichever path got there.
 */
export interface TransitionLifecycle {
  readonly openDirection: TransitionDirection | null;
  begin(direction: TransitionDirection): void;
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
    end(outcome) {
      if (open === null) return;
      const direction = open;
      open = null;
      emitter.emit('transitionEnd', { direction, outcome });
    },
  };
  return lifecycle;
}
