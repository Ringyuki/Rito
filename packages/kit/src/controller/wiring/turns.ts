import type { Reader, TurnAction, TurnDirection, TurnPages } from '@ritojs/core';

import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../../painter/buffer-pool';
import type { PrerenderScheduler } from '../prerender';
import { commitCurrentSpread } from '../core/current-spread';
import { publishSpreadChange } from '../core/spread-change';
import { transitionLifecycle } from '../core/transition-lifecycle';
import type { Internals } from '../facade';
import type { Emitter } from '../facade/types';

export interface TurnWiringDeps {
  readonly internals: Internals;
  readonly td: TransitionDriver;
  readonly pool: PageBufferPool;
  readonly emitter: Emitter;
  readonly frameDriver: FrameDriver;
  readonly reader: Reader;
  readonly contentRenderer: ContentRenderer;
  readonly prerenderScheduler: PrerenderScheduler;
}

/**
 * Where the kit's turns go: to the neighbour, or to a spread further off a
 * navigation named. A named spread holds for the one turn commanded to it,
 * until it lands or ends.
 */
export interface TurnTargets {
  /** The spread a turn `direction` brings in. */
  of(direction: TurnDirection): number;
  /** The next turn `direction` brings in `spread`, a spread further off than the neighbour. */
  aim(direction: TurnDirection, spread: number): void;
  /**
   * Something else moves the reader now: turns go to the neighbours again,
   * and a turn still waiting for its page is withdrawn (the engine is told
   * that page will not be had).
   */
  forget(): void;
}

const slotOf = (direction: TurnDirection): 'next' | 'prev' =>
  direction === 'next' ? 'next' : 'prev';

/** The turn the kit is carrying out. */
interface TurnState {
  /** A spread further off a navigation named for the turn commanded to it. */
  aimed: { readonly direction: TurnDirection; readonly spread: number } | null;
  /** The turn on screen has landed the reader on its spread. */
  landed: boolean;
  /** A waiting turn is being withdrawn: no page is to be had either way. */
  withdrawing: boolean;
}

const NEITHER = { next: false, previous: false } as const;
const NO_TURN: TurnPages = { canTurn: NEITHER, there: NEITHER, drawable: NEITHER, beyond: NEITHER };

/**
 * Carries out the page turns the engine decides: a turn begins (its page
 * brought into its slot, `transitionStart`), lands when it is decided (the
 * reader's current spread is the one it brings in, `spreadChange`), and
 * ends (`transitionEnd`). The pages rotate when a turn that landed ends,
 * however it ends: a landed turn cut off by a jump has moved the reader all
 * the same. A turn that goes back never moved the reader: nothing is put back.
 */
export function wireTurns(deps: TurnWiringDeps): {
  readonly targets: TurnTargets;
  readonly dispose: () => void;
} {
  const turn: TurnState = { aimed: null, landed: false, withdrawing: false };
  const targets: TurnTargets = {
    of(direction) {
      if (turn.aimed?.direction === direction) return turn.aimed.spread;
      const current = deps.internals.currentSpread;
      return direction === 'next' ? current + 1 : current - 1;
    },
    aim(direction, spread) {
      turn.aimed = { direction, spread };
    },
    forget() {
      turn.aimed = null;
      turn.withdrawing = true;
      try {
        deps.td.pagesChanged();
      } finally {
        turn.withdrawing = false;
      }
    },
  };
  deps.td.pagesFrom(() => (turn.withdrawing ? NO_TURN : pagesNow(deps, targets)));
  const stopActions = deps.td.onAction((action) => {
    act(deps, targets, turn, action);
  });
  const stopRest = deps.td.onRest(() => {
    prerender(deps);
  });
  return {
    targets,
    dispose: () => {
      stopActions();
      stopRest();
    },
  };
}

function act(
  deps: TurnWiringDeps,
  targets: TurnTargets,
  turn: TurnState,
  action: TurnAction,
): void {
  switch (action.kind) {
    case 'started':
      bring(deps, targets, action.direction);
      transitionLifecycle(deps.emitter).begin(action.direction === 'next' ? 'forward' : 'backward');
      deps.frameDriver.scheduleComposite();
      return;
    case 'land':
      turn.landed = true;
      land(deps, targets.of(action.direction));
      // Landed, the turn's spread is the one shown: turns from it go to its neighbours.
      turn.aimed = null;
      deps.td.landed(true);
      return;
    case 'ended':
      if (turn.landed) {
        if (action.direction === 'next') deps.pool.rotateForward();
        else deps.pool.rotateBackward();
        prerender(deps, slotOf(action.direction));
      }
      turn.landed = false;
      turn.aimed = null;
      transitionLifecycle(deps.emitter).end(action.outcome);
      deps.frameDriver.scheduleComposite();
      return;
    case 'fetch':
      if (bring(deps, targets, action.direction)) deps.td.pagesChanged();
      deps.frameDriver.scheduleComposite();
      return;
    case 'wait-for-effect':
    case 'rested':
      return;
  }
}

/** The reader is on the spread the decided turn brings in. */
function land(deps: TurnWiringDeps, target: number): void {
  const { internals, reader, emitter } = deps;
  commitCurrentSpread(internals, target, 'turn-land');
  reader.notifyActiveSpread(target);
  if (internals.currentSpread !== target) return;
  publishSpreadChange(emitter, reader, target);
}

/** Brings the page a turn `direction` shows into its slot; true once it is painted there. */
export function bring(
  deps: TurnWiringDeps,
  targets: TurnTargets,
  direction: TurnDirection,
): boolean {
  const spread = targets.of(direction);
  if (spread < 0 || spread >= deps.reader.totalSpreads) return false;
  const slot = slotOf(direction);
  if (deps.pool.getSlotFor(spread) !== slot) deps.pool.assignSlot(slot, spread);
  return deps.pool.ensureContent(slot, deps.contentRenderer);
}

function pagesNow(deps: TurnWiringDeps, targets: TurnTargets): TurnPages {
  const total = deps.reader.totalSpreads;
  const side = (direction: TurnDirection) => {
    const spread = targets.of(direction);
    const valid = spread >= 0 && spread < total;
    const slot = slotOf(direction);
    const there = valid && deps.pool.getSlotFor(spread) === slot && !deps.pool[slot].contentDirty;
    return { valid, there };
  };
  const next = side('next');
  const previous = side('previous');
  const can = { next: next.valid, previous: previous.valid };
  return {
    canTurn: can,
    there: { next: next.there, previous: previous.there },
    drawable: { next: true, previous: true },
    // The reader lands a turn as soon as it is decided: beyond the page a
    // turn brings in is beyond the page shown by then.
    beyond: can,
  };
}

function prerender(deps: TurnWiringDeps, eagerPosition?: 'next' | 'prev'): void {
  const { internals, td, reader, pool, contentRenderer, frameDriver } = deps;
  deps.prerenderScheduler.schedule({
    getCurrentSpread: () => internals.currentSpread,
    isAnimating: () => td.isAnimating,
    reader,
    pool,
    contentRenderer,
    ...(eagerPosition ? { eagerPosition } : {}),
    painted: () => {
      frameDriver.warmTransition();
    },
  });
}
