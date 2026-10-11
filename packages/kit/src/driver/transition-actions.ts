import type { TransitionTouch } from './effects';
import { rubberBand } from './rubber-band';
import { activePhysics, type TransitionDriverState } from './transition-state';
import { estimateVelocity, VELOCITY_WINDOW_SIZE } from './transition-velocity';
import type { TransitionMode } from './types';

/** Time horizon (ms) for projecting current velocity into commit decision. */
const PROJECTION_MS = 150;

type Direction = 'forward' | 'backward';

/** The part of a turn that stays the same while it is held, landing or going back. */
interface TurnIdentity {
  readonly direction: Direction;
  readonly outgoingSpread: number;
  readonly incomingSpread: number | null;
  readonly touch: TransitionTouch | null;
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
  state.velocitySamples = [{ dx: 0, timestamp }];
  state.mode = {
    kind: 'tracking',
    direction,
    outgoingSpread,
    incomingSpread,
    dx: 0,
    vx: 0,
    lastSampleAt: timestamp,
    touch: null,
  };
}

export function updateTrackingMode(
  state: TransitionDriverState,
  rawDx: number,
  timestamp: number,
  touch?: TransitionTouch,
): void {
  if (state.mode.kind !== 'tracking') return;
  const dx = state.mode.incomingSpread === null ? resisted(state, rawDx) : rawDx;
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

export function goToTargetMode(
  state: TransitionDriverState,
  direction: Direction,
  outgoingSpread: number,
  incomingSpread: number | null,
  initialDx: number,
): void {
  const turn = { direction, outgoingSpread, incomingSpread, touch: null };
  state.mode = settling(state, turn, turnTarget(state, direction), initialDx, 0);
}

export function interruptMode(
  state: TransitionDriverState,
  timestamp: number,
): { dx: number; vx: number } | null {
  if (state.mode.kind === 'settling') {
    const { direction, outgoingSpread, incomingSpread, dx, touch } = state.mode;
    const vx = dragVelocity(state.mode.vx);
    state.mode = {
      kind: 'tracking',
      direction,
      outgoingSpread,
      incomingSpread,
      dx,
      vx,
      lastSampleAt: timestamp,
      touch,
    };
    return { dx, vx };
  }
  if (state.mode.kind === 'boundary-elastic') {
    const { direction, slotSpread, dx, touch } = state.mode;
    const vx = dragVelocity(state.mode.vx);
    state.mode = {
      kind: 'tracking',
      direction,
      outgoingSpread: slotSpread,
      incomingSpread: null,
      dx,
      vx,
      lastSampleAt: timestamp,
      touch,
    };
    return { dx, vx };
  }
  return null;
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
  };
}

function resisted(state: TransitionDriverState, rawDx: number): number {
  const width = state.viewportWidth;
  return (
    activePhysics(state)?.resist?.(rawDx, width) ??
    rubberBand(rawDx, width, state.opts.elasticFactor)
  );
}

/** Whether a release turns the page: the physics' rule, else the built-in one. */
function lands(state: TransitionDriverState, turn: TurnIdentity, dx: number, vx: number): boolean {
  const physics = activePhysics(state);
  if (physics?.lands) {
    return physics.lands({
      dx,
      velocity: springVelocity(vx),
      width: state.viewportWidth,
      direction: turn.direction,
      touch: turn.touch,
    });
  }
  if (shouldCancelTracking(turn.direction, dx, vx)) return false;
  return (
    Math.abs(dx + vx * PROJECTION_MS) > state.opts.swipeThreshold ||
    Math.abs(vx) > state.opts.velocityCommit
  );
}

function shouldCancelTracking(direction: Direction, dx: number, vx: number): boolean {
  const dxReversed = (direction === 'forward' && dx > 0) || (direction === 'backward' && dx < 0);
  const pullingBack =
    (direction === 'forward' && vx > 0.05) || (direction === 'backward' && vx < -0.05);
  return dxReversed || pullingBack;
}
