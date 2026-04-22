import { rubberBand } from './rubber-band';
import type { TransitionDriverState } from './transition-state';
import { estimateVelocity, VELOCITY_WINDOW_SIZE } from './transition-velocity';

/** Time horizon (ms) for projecting current velocity into commit decision. */
const PROJECTION_MS = 150;

export function startTrackingMode(
  state: TransitionDriverState,
  direction: 'forward' | 'backward',
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
  };
}

export function updateTrackingMode(
  state: TransitionDriverState,
  rawDx: number,
  timestamp: number,
): void {
  if (state.mode.kind !== 'tracking') return;
  const dx =
    state.mode.incomingSpread === null
      ? rubberBand(rawDx, state.viewportWidth, state.opts.elasticFactor)
      : rawDx;
  state.velocitySamples.push({ dx, timestamp });
  if (state.velocitySamples.length > VELOCITY_WINDOW_SIZE) state.velocitySamples.shift();
  state.mode.vx = estimateVelocity(state.velocitySamples);
  state.mode.dx = dx;
  state.mode.lastSampleAt = timestamp;
}

export function releaseTrackingMode(state: TransitionDriverState): 'commit' | 'cancel' {
  if (state.mode.kind !== 'tracking') return 'cancel';
  const { direction, outgoingSpread, incomingSpread, dx, vx } = state.mode;
  if (incomingSpread === null) {
    state.mode = { kind: 'boundary-elastic', slotSpread: outgoingSpread, dx, vx };
    return 'cancel';
  }
  if (shouldCancelTracking(direction, dx, vx)) {
    state.mode = { kind: 'settling', direction, outgoingSpread, incomingSpread, target: 0, dx, vx };
    return 'cancel';
  }
  const committed =
    Math.abs(dx + vx * PROJECTION_MS) > state.opts.swipeThreshold ||
    Math.abs(vx) > state.opts.velocityCommit;
  const target = committed
    ? direction === 'forward'
      ? -state.viewportWidth
      : state.viewportWidth
    : 0;
  state.mode = { kind: 'settling', direction, outgoingSpread, incomingSpread, target, dx, vx };
  return committed ? 'commit' : 'cancel';
}

export function goToTargetMode(
  state: TransitionDriverState,
  direction: 'forward' | 'backward',
  outgoingSpread: number,
  incomingSpread: number | null,
  initialDx: number,
): void {
  const target = direction === 'forward' ? -state.viewportWidth : state.viewportWidth;
  state.mode = {
    kind: 'settling',
    direction,
    outgoingSpread,
    incomingSpread,
    target,
    dx: initialDx,
    vx: 0,
  };
}

export function interruptMode(
  state: TransitionDriverState,
  timestamp: number,
): { dx: number; vx: number } | null {
  if (state.mode.kind === 'settling') {
    const { direction, outgoingSpread, incomingSpread, dx, vx } = state.mode;
    state.mode = {
      kind: 'tracking',
      direction,
      outgoingSpread,
      incomingSpread,
      dx,
      vx,
      lastSampleAt: timestamp,
    };
    return { dx, vx };
  }
  if (state.mode.kind === 'boundary-elastic') {
    const { slotSpread, dx, vx } = state.mode;
    state.mode = {
      kind: 'tracking',
      direction: 'forward',
      outgoingSpread: slotSpread,
      incomingSpread: null,
      dx,
      vx,
      lastSampleAt: timestamp,
    };
    return { dx, vx };
  }
  return null;
}

function shouldCancelTracking(direction: 'forward' | 'backward', dx: number, vx: number): boolean {
  const dxReversed = (direction === 'forward' && dx > 0) || (direction === 'backward' && dx < 0);
  const pullingBack =
    (direction === 'forward' && vx > 0.05) || (direction === 'backward' && vx < -0.05);
  return dxReversed || pullingBack;
}
