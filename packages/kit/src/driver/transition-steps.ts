import type { TurnMotionState } from '@ritojs/core';

import type { TransitionDriverState, TurnIdentity } from './transition-state';
import type { DrawInstruction, TransitionMode } from './types';

type TurningInstruction = DrawInstruction & { kind: 'turning' };

/**
 * The frame of a turn on screen: which pages, how far, and what is moving
 * it. A turn that began from what another left is, until it has crossed its
 * own start, still that picture: the frame names the neighbour that turn
 * left in it, on its way out.
 */
export function instructionOf(now: TurnMotionState, turn: TurnIdentity | null): TurningInstruction {
  const finishing = now.phase === 'finishing';
  const phase =
    now.phase === 'dragging' ? 'held' : !finishing && now.landing ? 'landing' : 'returning';
  return {
    kind: 'turning',
    outgoing: 'curr',
    incoming: now.showing,
    dx: now.offset,
    phase,
    velocity: now.velocity,
    touch: finishing ? null : (turn?.touch ?? null),
  };
}

/** The turn as the driver's modes tell it: what its tests and its host read. */
export function modeOf(state: TransitionDriverState): TransitionMode {
  const now = state.motion?.state;
  const turn = state.turn;
  if (!now || now.phase === 'idle' || !turn) return { kind: 'idle' };
  const { direction, outgoingSpread, incomingSpread, touch } = turn;
  const leaving = now.leaving;
  switch (now.phase) {
    case 'dragging':
      return {
        kind: 'tracking',
        direction,
        outgoingSpread,
        incomingSpread: now.hasIncoming ? incomingSpread : null,
        dx: now.offset,
        vx: now.fingerVelocity / 1000,
        lastSampleAt: turn.lastSampleAt,
        touch,
        from: now.from,
        leaving,
      };
    case 'settling':
      return settlingModeOf(now, turn);
    case 'finishing':
      return {
        kind: 'finishing',
        leaving: leaving ?? 'none',
        dx: now.offset,
        vx: now.velocity,
        shift: now.shift,
      };
  }
}

/** A turn going by itself: to its neighbour or back, or back from a pull against the end of the book. */
function settlingModeOf(now: TurnMotionState, turn: TurnIdentity): TransitionMode {
  const { direction, outgoingSpread, incomingSpread, touch } = turn;
  const moving = { direction, dx: now.offset, vx: now.velocity, touch, leaving: now.leaving };
  return now.hasIncoming
    ? { kind: 'settling', ...moving, outgoingSpread, incomingSpread, target: now.target }
    : { kind: 'boundary-elastic', ...moving, slotSpread: outgoingSpread };
}
