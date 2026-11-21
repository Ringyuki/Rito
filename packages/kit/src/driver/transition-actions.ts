import type { TurnMotionBegin } from '@ritojs/core';

import type { TransitionTouch } from './effects';
import {
  activePhysics,
  followSettle,
  motionOf,
  motionState,
  type TransitionDriverState,
} from './transition-state';

type Direction = 'forward' | 'backward';

export function startTrackingMode(
  state: TransitionDriverState,
  direction: Direction,
  outgoingSpread: number,
  incomingSpread: number | null,
  timestamp: number,
): void {
  const motion = motionOf(state);
  // A finger that cuts into a turn takes the picture from where that turn left it.
  const begin = beginOf(state, direction, incomingSpread !== null);
  motion.startDrag(direction === 'forward', incomingSpread !== null, timestamp, begin);
  state.turn = { direction, outgoingSpread, incomingSpread, touch: null, lastSampleAt: timestamp };
  state.settle = null;
}

export function updateTrackingMode(
  state: TransitionDriverState,
  rawDx: number,
  timestamp: number,
  touch?: TransitionTouch,
): void {
  const now = motionState(state);
  if (now?.phase !== 'dragging' || !state.turn) return;
  const motion = motionOf(state);
  // A pull with no neighbour stretches as the physics say, else by the
  // engine's rule; what the turn had already travelled does not.
  const physics = activePhysics(state);
  if (!now.hasIncoming && physics?.resist) {
    motion.dragCarried(physics.resist(rawDx, state.viewportWidth), timestamp);
  } else {
    motion.drag(rawDx, timestamp);
  }
  state.turn.lastSampleAt = timestamp;
  if (touch) state.turn.touch = touch;
}

export function releaseTrackingMode(state: TransitionDriverState): 'commit' | 'cancel' {
  const now = motionState(state);
  if (now?.phase !== 'dragging' || !state.turn) return 'cancel';
  const motion = motionOf(state);
  const physics = activePhysics(state);
  const decided =
    physics?.lands && now.hasIncoming
      ? physics.lands({
          dx: now.offset,
          from: now.from,
          velocity: now.fingerVelocity,
          width: state.viewportWidth,
          direction: state.turn.direction,
          touch: state.turn.touch,
          spine: state.spine,
        })
      : undefined;
  const committed = motion.release(decided);
  followSettle(state);
  return committed ? 'commit' : 'cancel';
}

/** Sends an owned drag or settle back to its outgoing spread. */
export function cancelTrackingMode(state: TransitionDriverState): boolean {
  const phase = motionState(state)?.phase;
  if (phase !== 'dragging' && phase !== 'settling') return false;
  const cancelled = motionOf(state).cancel();
  followSettle(state);
  return cancelled;
}

/** A turn no finger holds, from what the turn it cut into left: where that was, as fast. */
export function goToTargetMode(
  state: TransitionDriverState,
  direction: Direction,
  outgoingSpread: number,
  incomingSpread: number | null,
): void {
  const motion = motionOf(state);
  const begin = beginOf(state, direction, incomingSpread !== null);
  motion.turn(direction === 'forward', begin);
  state.turn = { direction, outgoingSpread, incomingSpread, touch: null, lastSampleAt: 0 };
  followSettle(state);
}

export function interruptMode(
  state: TransitionDriverState,
  timestamp: number,
): { dx: number; vx: number } | null {
  const now = motionState(state);
  if (now?.phase !== 'settling' || !motionOf(state).interrupt(timestamp)) return null;
  state.settle = null;
  if (state.turn) state.turn.lastSampleAt = timestamp;
  // The finger's speed is measured from here on, px/ms, and its travel added to where the turn is.
  return { dx: now.offset, vx: now.velocity / 1000 };
}

/**
 * Where a turn beginning now, `direction` with or without a neighbour to
 * bring in, starts when the physics say: what they make of what the turn
 * it cut into left. Undefined for the engine's own rule, where the picture is.
 */
function beginOf(
  state: TransitionDriverState,
  direction: Direction,
  hasIncoming: boolean,
): TurnMotionBegin | undefined {
  const now = motionState(state);
  const physics = activePhysics(state);
  if (!physics?.begins || now?.phase !== 'finishing' || now.leaving === null) return undefined;
  const own = hasIncoming ? (direction === 'forward' ? 'next' : 'prev') : null;
  const at = physics.begins({
    dx: now.offset,
    velocity: now.velocity,
    width: state.viewportWidth,
    direction,
    sameSpreads: now.leaving === own,
  });
  return { offset: at.dx, velocity: at.velocity };
}
