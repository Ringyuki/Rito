import type { TurnMotionState } from '@ritojs/core';

import { instructionOf } from './transition-steps';
import {
  activeEffect,
  followSettle,
  motionOf,
  type TransitionDriverState,
  type TurnIdentity,
} from './transition-state';
import type { DrawInstruction, SettledEvent } from './types';

const SINGLE: DrawInstruction = { kind: 'single', slot: 'curr' };

/** Moves the driver on by `dt` ms and says what to draw. */
export function stepTransition(state: TransitionDriverState, dt: number): DrawInstruction {
  const before = state.motion?.state;
  if (!before || before.phase === 'idle') return SINGLE;
  if (before.phase === 'dragging') return instructionOf(before, state.turn);
  const seconds = dt / 1000;
  const host = state.settle?.at(before.elapsed + seconds);
  const step = motionOf(state).step(seconds, host, activeEffect(state).instant === true);
  if (step === 'rested') {
    state.settle = null;
    for (const cb of state.restListeners) cb();
    return SINGLE;
  }
  if ((step === 'committed' || step === 'cancelled') && state.turn) {
    state.settle = null;
    emitSettled(state, settledEvent(state.turn, step === 'committed'));
    return SINGLE;
  }
  return instructionOf(motionOf(state).state, state.turn);
}

/**
 * Cuts into the open turn for another to begin: its outcome is settled now,
 * as a forced settle would settle it, and reported; its picture carries on
 * from where it is until the next turn takes it up or it comes to rest. A
 * turn that lands at once has nothing left to show.
 */
export function handOver(state: TransitionDriverState): void {
  const now = state.motion?.state;
  if (!now || !state.turn || now.phase === 'idle' || now.phase === 'finishing') return;
  const settled = settledEvent(state.turn, outcomeOf(now, state.turn));
  const motion = motionOf(state);
  if (activeEffect(state).instant) motion.reset();
  else motion.carryOn(settled.committed);
  followSettle(state);
  emitSettled(state, settled);
}

/** Stops whatever is moving where it stands, reporting a turn that was open; the dx it stopped at. */
export function forceSettle(state: TransitionDriverState): number {
  const now = state.motion?.state;
  if (!now || now.phase === 'idle') return 0;
  const turn = state.turn;
  state.motion?.reset();
  state.settle = null;
  // What was left of a turn that was cut into was reported when it was cut into.
  if (now.phase !== 'finishing' && turn) {
    emitSettled(state, settledEvent(turn, outcomeOf(now, turn)));
  }
  return now.offset;
}

export function emitSettled(state: TransitionDriverState, event: SettledEvent): void {
  for (const cb of state.settledListeners) cb(event);
}

/**
 * How an open turn ends when it is cut short: one going by itself where
 * it was going, one a finger holds on its neighbour if it has one, a pull
 * against the end of the book where it began.
 */
function outcomeOf(now: TurnMotionState, turn: TurnIdentity): boolean {
  if (now.phase === 'dragging') return now.hasIncoming && turn.incomingSpread !== null;
  return now.hasIncoming && now.target !== 0;
}

function settledEvent(turn: TurnIdentity, committed: boolean): SettledEvent {
  return {
    direction: turn.direction,
    committed,
    targetSpread: committed ? (turn.incomingSpread ?? turn.outgoingSpread) : turn.outgoingSpread,
  };
}
