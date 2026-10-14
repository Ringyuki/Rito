import { stepSpring, type SpringState } from './spring';
import type {
  DrawInstruction,
  SettledEvent,
  TransitionDriverOptions,
  TransitionMode,
} from './types';

export type TurningMode = TransitionMode & {
  kind: 'tracking' | 'settling' | 'boundary-elastic';
};
type RestingMode = TransitionMode & { kind: 'settling' | 'boundary-elastic' };
type FinishingMode = TransitionMode & { kind: 'finishing' };
type TurningInstruction = DrawInstruction & { kind: 'turning' };

/**
 * The frame of a turn on screen: which pages, how far, and what is moving
 * it. A turn that began from what another left is, until it has crossed its
 * own start, still that picture: the frame names the neighbour that turn
 * left in it, on its way out.
 */
export function turningInstruction(mode: TurningMode): TurningInstruction {
  const far = mode.direction === 'forward' ? mode.dx > 0 : mode.dx < 0;
  const before = far ? mode.leaving : null;
  const incoming = before === null ? ownIncoming(mode) : before === 'none' ? null : before;
  return {
    kind: 'turning',
    outgoing: 'curr',
    incoming,
    dx: mode.dx,
    phase: mode.kind === 'tracking' ? 'held' : before === null ? ownPhase(mode) : 'returning',
    velocity: mode.kind === 'tracking' ? 0 : mode.vx,
    touch: mode.touch,
  };
}

/** The neighbour a turn brings in itself; none for a pull against the end of the book. */
function ownIncoming(mode: TurningMode): 'next' | 'prev' | null {
  if (mode.kind === 'boundary-elastic' || mode.incomingSpread === null) return null;
  return mode.direction === 'forward' ? 'next' : 'prev';
}

function ownPhase(mode: RestingMode): 'landing' | 'returning' {
  return mode.kind === 'settling' && mode.target !== 0 ? 'landing' : 'returning';
}

/** The frame of what a turn that was cut into has left to travel. */
export function finishingInstruction(mode: FinishingMode): TurningInstruction {
  return {
    kind: 'turning',
    outgoing: 'curr',
    incoming: mode.leaving === 'none' ? null : mode.leaving,
    dx: mode.dx,
    phase: 'returning',
    velocity: mode.vx,
    touch: null,
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
  const done = instant || advance(mode, mode.target, 0, opts, dt);
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
  if (advance(mode, 0, 0, opts, dt)) {
    return {
      nextMode: { kind: 'idle' },
      instruction: { kind: 'single', slot: 'curr' },
      settled: { direction: mode.direction, committed: false, targetSpread: mode.slotSpread },
    };
  }
  return { nextMode: mode, instruction: turningInstruction(mode) };
}

/**
 * Step what is left of a turn that was cut into. It was reported settled
 * when it was cut into, so coming to rest reports nothing.
 */
export function stepFinishing(
  mode: FinishingMode,
  opts: TransitionDriverOptions,
  dt: number,
): { nextMode: TransitionMode; instruction: DrawInstruction } {
  if (advance(mode, 0, mode.shift, opts, dt)) {
    return { nextMode: { kind: 'idle' }, instruction: { kind: 'single', slot: 'curr' } };
  }
  return { nextMode: mode, instruction: finishingInstruction(mode) };
}

/**
 * Moves a turn nothing holds on by `dt` ms toward `target`: by the motion
 * its physics brought, read off at the time elapsed and moved by `shift`,
 * else by the spring. True when it has come to rest.
 */
function advance(
  mode: RestingMode | FinishingMode,
  target: number,
  shift: number,
  opts: TransitionDriverOptions,
  dt: number,
): boolean {
  if (mode.settle) {
    mode.elapsed += dt / 1000;
    const at = mode.settle(mode.elapsed);
    mode.dx = at.done ? target : at.x + shift;
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

    // Its turn was reported when it was cut into.
    case 'finishing':
      return { residualDx: mode.dx, settled: null };

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
