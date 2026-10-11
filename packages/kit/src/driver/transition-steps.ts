import { stepSpring, type SpringState } from './spring';
import type {
  DrawInstruction,
  SettledEvent,
  TransitionDriverOptions,
  TransitionMode,
} from './types';

type TurningMode = TransitionMode & { kind: 'tracking' | 'settling' | 'boundary-elastic' };
type RestingMode = TransitionMode & { kind: 'settling' | 'boundary-elastic' };

/** The frame of a turn on screen: which pages, how far, and what is moving it. */
export function turningInstruction(mode: TurningMode): DrawInstruction {
  if (mode.kind === 'boundary-elastic') {
    return {
      kind: 'turning',
      outgoing: 'curr',
      incoming: null,
      dx: mode.dx,
      phase: 'returning',
      velocity: mode.vx,
      touch: mode.touch,
    };
  }
  const incoming =
    mode.incomingSpread === null ? null : mode.direction === 'forward' ? 'next' : 'prev';
  if (mode.kind === 'tracking') {
    return {
      kind: 'turning',
      outgoing: 'curr',
      incoming,
      dx: mode.dx,
      phase: 'held',
      velocity: 0,
      touch: mode.touch,
    };
  }
  return {
    kind: 'turning',
    outgoing: 'curr',
    incoming,
    dx: mode.dx,
    phase: mode.target === 0 ? 'returning' : 'landing',
    velocity: mode.vx,
    touch: mode.touch,
  };
}

/** Step a settling turn and return the new mode + draw instruction. */
export function stepSettling(
  mode: TransitionMode & { kind: 'settling' },
  opts: TransitionDriverOptions,
  dt: number,
  instant = false,
): { nextMode: TransitionMode; instruction: DrawInstruction; settled?: SettledEvent } {
  // An instant effect lands on its first frame.
  const done = instant || advance(mode, mode.target, opts, dt);
  if (done) {
    mode.dx = mode.target;
    mode.vx = 0;
    const committed = mode.target !== 0;
    return {
      nextMode: { kind: 'idle' },
      instruction: { kind: 'single', slot: 'curr' },
      settled: {
        direction: mode.direction,
        committed,
        targetSpread: committed
          ? (mode.incomingSpread ?? mode.outgoingSpread)
          : mode.outgoingSpread,
      },
    };
  }
  return { nextMode: mode, instruction: turningInstruction(mode) };
}

/** Step a pull against the end of the book on its way back. */
export function stepBoundaryElastic(
  mode: TransitionMode & { kind: 'boundary-elastic' },
  opts: TransitionDriverOptions,
  dt: number,
): { nextMode: TransitionMode; instruction: DrawInstruction; settled?: SettledEvent } {
  if (advance(mode, 0, opts, dt)) {
    return {
      nextMode: { kind: 'idle' },
      instruction: { kind: 'single', slot: 'curr' },
      settled: { direction: mode.direction, committed: false, targetSpread: mode.slotSpread },
    };
  }
  return { nextMode: mode, instruction: turningInstruction(mode) };
}

/**
 * Moves a turn nothing holds on by `dt` ms toward `target`: by the motion
 * its physics brought, read off at the time elapsed, else by the spring.
 * True when it has come to rest.
 */
function advance(
  mode: RestingMode,
  target: number,
  opts: TransitionDriverOptions,
  dt: number,
): boolean {
  if (mode.settle) {
    mode.elapsed += dt / 1000;
    const at = mode.settle(mode.elapsed);
    mode.dx = at.done ? target : at.x;
    mode.vx = at.done ? 0 : at.velocity;
    return at.done;
  }
  const spring: SpringState = { x: mode.dx, vx: mode.vx };
  const done = stepSpring(spring, target, opts, dt);
  mode.dx = spring.x;
  mode.vx = spring.vx;
  return done;
}

/** Force-settle any mode and return the settled event (if applicable). */
export function forceSettleMode(mode: TransitionMode): {
  residualDx: number;
  settled: SettledEvent | null;
} {
  switch (mode.kind) {
    case 'idle':
      return { residualDx: 0, settled: null };

    case 'settling': {
      const committed = mode.target !== 0;
      return {
        residualDx: mode.dx,
        settled: {
          direction: mode.direction,
          committed,
          targetSpread: committed
            ? (mode.incomingSpread ?? mode.outgoingSpread)
            : mode.outgoingSpread,
        },
      };
    }

    case 'tracking': {
      const committed = mode.incomingSpread !== null;
      return {
        residualDx: mode.dx,
        settled: {
          direction: mode.direction,
          committed,
          targetSpread: committed ? mode.incomingSpread : mode.outgoingSpread,
        },
      };
    }

    case 'boundary-elastic':
      return {
        residualDx: mode.dx,
        settled: {
          direction: mode.direction,
          committed: false,
          targetSpread: mode.slotSpread,
        },
      };
  }
}
