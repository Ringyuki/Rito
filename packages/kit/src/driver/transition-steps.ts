import { stepSpring, type SpringState } from './spring';
import type {
  DrawInstruction,
  SettledEvent,
  TransitionDriverOptions,
  TransitionMode,
} from './types';

type SlotPositions = {
  outgoing: 'curr' | 'prev' | 'next';
  incoming: 'curr' | 'prev' | 'next' | null;
};

/** Map mode to slot positions for draw instructions. */
export function getSlotPositions(
  m: TransitionMode & { kind: 'tracking' | 'settling' },
): SlotPositions {
  return {
    outgoing: 'curr',
    incoming: m.incomingSpread !== null ? (m.direction === 'forward' ? 'next' : 'prev') : null,
  };
}

/** Build a turning DrawInstruction from slot positions and dx. */
function turningInstruction(slots: SlotPositions, dx: number): DrawInstruction {
  return { kind: 'turning', outgoing: slots.outgoing, incoming: slots.incoming, dx };
}

/** Step the settling spring and return the new mode + draw instruction. */
export function stepSettling(
  mode: TransitionMode & { kind: 'settling' },
  opts: TransitionDriverOptions,
  dt: number,
): { nextMode: TransitionMode; instruction: DrawInstruction; settled?: SettledEvent } {
  const spring: SpringState = { x: mode.dx, vx: mode.vx };
  const done = stepSpring(spring, mode.target, opts, dt);
  mode.dx = spring.x;
  mode.vx = spring.vx;

  if (done) {
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
  return { nextMode: mode, instruction: turningInstruction(getSlotPositions(mode), mode.dx) };
}

/** Step the boundary-elastic spring and return the new mode + draw instruction. */
export function stepBoundaryElastic(
  mode: TransitionMode & { kind: 'boundary-elastic' },
  opts: TransitionDriverOptions,
  dt: number,
): { nextMode: TransitionMode; instruction: DrawInstruction; settled?: SettledEvent } {
  const spring: SpringState = { x: mode.dx, vx: mode.vx };
  const done = stepSpring(spring, 0, opts, dt);
  mode.dx = spring.x;
  mode.vx = spring.vx;

  if (done) {
    return {
      nextMode: { kind: 'idle' },
      instruction: { kind: 'single', slot: 'curr' },
      settled: { direction: 'forward', committed: false, targetSpread: mode.slotSpread },
    };
  }
  return {
    nextMode: mode,
    instruction: { kind: 'turning', outgoing: 'curr', incoming: null, dx: mode.dx },
  };
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
        settled: { direction: 'forward', committed: false, targetSpread: mode.slotSpread },
      };
  }
}
