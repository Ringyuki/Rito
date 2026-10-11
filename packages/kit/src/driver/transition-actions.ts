import type { TransitionTouch } from './effects';
import { rubberBand } from './rubber-band';
import { beginningOf } from './transition-hand-over';
import { activePhysics, type TransitionDriverState } from './transition-state';
import { estimateVelocity, VELOCITY_WINDOW_SIZE } from './transition-velocity';
import type { LeavingNeighbour, TransitionMode } from './types';

/** Time horizon (ms) for projecting current velocity into commit decision. */
const PROJECTION_MS = 150;

type Direction = 'forward' | 'backward';

/** The part of a turn that stays the same while it is held, landing or going back. */
interface TurnIdentity {
  readonly direction: Direction;
  readonly outgoingSpread: number;
  readonly incomingSpread: number | null;
  readonly touch: TransitionTouch | null;
  readonly leaving: LeavingNeighbour | null;
}

// A drag measures its velocity in px/ms (pointer samples carry ms
// timestamps); the spring integrates in px/s. A release hands the finger's
// momentum to the spring, and an interrupt hands the spring's back.
const springVelocity = (pxPerMs: number): number => pxPerMs * 1000;
const dragVelocity = (pxPerSecond: number): number => pxPerSecond / 1000;

export function startTrackingMode(
  state: TransitionDriverState,
  direction: Direction,
  outgoingSpread: number,
  incomingSpread: number | null,
  timestamp: number,
): void {
  // A finger that cuts into a turn takes the picture from where that turn left it.
  const begun = beginningOf(state, direction, incomingSpread !== null);
  state.velocitySamples = [{ dx: begun.dx, timestamp }];
  state.mode = {
    kind: 'tracking',
    direction,
    outgoingSpread,
    incomingSpread,
    dx: begun.dx,
    vx: 0,
    lastSampleAt: timestamp,
    touch: null,
    from: begun.dx,
    leaving: begun.leaving,
  };
}

export function updateTrackingMode(
  state: TransitionDriverState,
  rawDx: number,
  timestamp: number,
  touch?: TransitionTouch,
): void {
  if (state.mode.kind !== 'tracking') return;
  // What the finger has carried the turn is added to where it took it; only that is resisted.
  const carried = state.mode.incomingSpread === null ? resisted(state, rawDx) : rawDx;
  const dx = withinAPage(state, state.mode.from + carried);
  state.velocitySamples.push({ dx, timestamp });
  if (state.velocitySamples.length > VELOCITY_WINDOW_SIZE) state.velocitySamples.shift();
  state.mode.vx = estimateVelocity(state.velocitySamples);
  state.mode.dx = dx;
  state.mode.lastSampleAt = timestamp;
  if (touch) state.mode.touch = touch;
}

export function releaseTrackingMode(state: TransitionDriverState): 'commit' | 'cancel' {
  if (state.mode.kind !== 'tracking') return 'cancel';
  const { dx, vx } = state.mode;
  const released = springVelocity(vx);
  if (state.mode.incomingSpread === null) {
    state.mode = boundaryElastic(state, state.mode, dx, released);
    return 'cancel';
  }
  const committed = lands(state, state.mode, dx, vx);
  const target = committed ? turnTarget(state, state.mode.direction) : 0;
  state.mode = settling(state, state.mode, target, dx, released);
  return committed ? 'commit' : 'cancel';
}

/** Retarget an owned drag or settle back to its outgoing spread. */
export function cancelTrackingMode(state: TransitionDriverState): boolean {
  if (state.mode.kind === 'tracking') {
    const vx = springVelocity(state.mode.vx);
    state.mode =
      state.mode.incomingSpread === null
        ? boundaryElastic(state, state.mode, state.mode.dx, vx)
        : settling(state, state.mode, 0, state.mode.dx, vx);
    return true;
  }
  if (state.mode.kind === 'settling') {
    state.mode = settling(state, state.mode, 0, state.mode.dx, state.mode.vx);
    return true;
  }
  return state.mode.kind === 'boundary-elastic';
}

/** A turn no finger holds, from what the turn it cut into left: where that was, as fast. */
export function goToTargetMode(
  state: TransitionDriverState,
  direction: Direction,
  outgoingSpread: number,
  incomingSpread: number | null,
): void {
  const begun = beginningOf(state, direction, incomingSpread !== null);
  const turn = { direction, outgoingSpread, incomingSpread, touch: null, leaving: begun.leaving };
  state.mode = settling(state, turn, turnTarget(state, direction), begun.dx, begun.vx);
}

export function interruptMode(
  state: TransitionDriverState,
  timestamp: number,
): { dx: number; vx: number } | null {
  const mode = state.mode;
  if (mode.kind !== 'settling' && mode.kind !== 'boundary-elastic') return null;
  const { direction, dx, touch, leaving } = mode;
  const vx = dragVelocity(mode.vx);
  // The finger's speed is measured from here on, and its travel added to where the turn is.
  state.velocitySamples = [{ dx, timestamp }];
  state.mode = {
    kind: 'tracking',
    direction,
    outgoingSpread: mode.kind === 'settling' ? mode.outgoingSpread : mode.slotSpread,
    incomingSpread: mode.kind === 'settling' ? mode.incomingSpread : null,
    dx,
    vx,
    lastSampleAt: timestamp,
    touch,
    from: dx,
    leaving,
  };
  return { dx, vx };
}

/** A turn goes no farther than a page width either way: beyond it there is no page to show. */
function withinAPage(state: TransitionDriverState, dx: number): number {
  const width = state.viewportWidth;
  return width > 0 ? Math.max(-width, Math.min(width, dx)) : dx;
}

function turnTarget(state: TransitionDriverState, direction: Direction): number {
  return direction === 'forward' ? -state.viewportWidth : state.viewportWidth;
}

/** A turn on its way to `target`, by the physics' own motion when they bring one. */
function settling(
  state: TransitionDriverState,
  turn: TurnIdentity,
  target: number,
  dx: number,
  vx: number,
): TransitionMode {
  return {
    kind: 'settling',
    direction: turn.direction,
    outgoingSpread: turn.outgoingSpread,
    incomingSpread: turn.incomingSpread,
    touch: turn.touch,
    target,
    dx,
    vx,
    settle: activePhysics(state)?.settle?.(dx, vx, target) ?? null,
    elapsed: 0,
    leaving: turn.leaving,
  };
}

/** A pull against the first or last spread on its way back. */
function boundaryElastic(
  state: TransitionDriverState,
  turn: TurnIdentity,
  dx: number,
  vx: number,
): TransitionMode {
  return {
    kind: 'boundary-elastic',
    direction: turn.direction,
    slotSpread: turn.outgoingSpread,
    touch: turn.touch,
    dx,
    vx,
    settle: activePhysics(state)?.settle?.(dx, vx, 0) ?? null,
    elapsed: 0,
    leaving: turn.leaving,
  };
}

function resisted(state: TransitionDriverState, rawDx: number): number {
  const width = state.viewportWidth;
  return (
    activePhysics(state)?.resist?.(rawDx, width) ??
    rubberBand(rawDx, width, state.opts.elasticFactor)
  );
}

/**
 * Whether a release turns the page: the physics' rule, else the built-in
 * one, which goes by how far the finger carried the turn. Where the turn
 * was when the finger took it says nothing of what the finger meant.
 */
function lands(
  state: TransitionDriverState,
  turn: TurnIdentity & { readonly from: number },
  dx: number,
  vx: number,
): boolean {
  const physics = activePhysics(state);
  if (physics?.lands) {
    return physics.lands({
      dx,
      from: turn.from,
      velocity: springVelocity(vx),
      width: state.viewportWidth,
      direction: turn.direction,
      touch: turn.touch,
    });
  }
  const carried = dx - turn.from;
  if (shouldCancelTracking(turn.direction, carried, vx)) return false;
  return (
    Math.abs(carried + vx * PROJECTION_MS) > state.opts.swipeThreshold ||
    Math.abs(vx) > state.opts.velocityCommit
  );
}

function shouldCancelTracking(direction: Direction, dx: number, vx: number): boolean {
  const dxReversed = (direction === 'forward' && dx > 0) || (direction === 'backward' && dx < 0);
  const pullingBack =
    (direction === 'forward' && vx > 0.05) || (direction === 'backward' && vx < -0.05);
  return dxReversed || pullingBack;
}
