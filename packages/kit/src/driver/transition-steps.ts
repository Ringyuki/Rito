import type { TurnControllerState } from '@ritojs/core';

import type { DrawInstruction, TransitionMode } from './types';

const SINGLE: DrawInstruction = { kind: 'single', slot: 'curr' };

/**
 * What to draw: the page at rest, or the frame of what is on screen. A turn
 * that began from what another left is, until it has crossed its own
 * start, still that picture: the frame names the neighbour that turn left
 * in it, on its way out.
 */
export function instructionOf(now: TurnControllerState | undefined): DrawInstruction {
  const frame = now?.frame;
  if (!frame) return SINGLE;
  return {
    kind: 'turning',
    outgoing: 'curr',
    incoming: frame.incoming,
    dx: frame.offset,
    phase: frame.phase,
    velocity: frame.velocity,
    touch: frame.touch,
  };
}

/** What is on screen as the driver's modes tell it: what its tests and its host read. */
export function modeOf(now: TurnControllerState | undefined): TransitionMode {
  const motion = now?.motion;
  if (!now || !motion || motion.phase === 'idle') return { kind: 'idle' };
  const direction = motion.forward ? 'forward' : 'backward';
  const touch = now.frame?.touch ?? null;
  const leaving = motion.leaving;
  switch (motion.phase) {
    case 'dragging':
      return {
        kind: 'tracking',
        direction,
        hasIncoming: motion.hasIncoming,
        dx: motion.offset,
        vx: motion.fingerVelocity / 1000,
        touch,
        from: motion.from,
        leaving,
      };
    case 'settling':
      return motion.hasIncoming
        ? {
            kind: 'settling',
            direction,
            target: motion.target,
            dx: motion.offset,
            vx: motion.velocity,
            touch,
            leaving,
          }
        : {
            kind: 'boundary-elastic',
            direction,
            dx: motion.offset,
            vx: motion.velocity,
            touch,
            leaving,
          };
    case 'finishing':
      return {
        kind: 'finishing',
        leaving: leaving ?? 'none',
        dx: motion.offset,
        vx: motion.velocity,
        shift: motion.shift,
      };
  }
}
