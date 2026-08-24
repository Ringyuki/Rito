/**
 * Spring physics — half-implicit Euler integration.
 *
 * Models a damped harmonic oscillator:
 *   force = -stiffness * (x - target)
 *   vx += (force - damping * vx) * dt
 *   x  += vx * dt
 */

export interface SpringState {
  x: number;
  vx: number;
}

export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
}

// Settle only once motion is imperceptible (sub-pixel AND essentially
// stationary) — the 0.13 thresholds. A coarser cut (4px / 300px/s) once
// chopped the spring's tail and every page turn ended with a visible
// snap instead of the eased landing.
const SETTLE_DISTANCE_PX = 0.5;
const SETTLE_SPEED_PX_PER_SECOND = 0.05;

/**
 * Advance the spring by `dt` milliseconds toward `target`.
 * Mutates `state` in place and returns whether the spring has settled.
 */
export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): boolean {
  // Convert dt to seconds for physics calculation
  const dtSec = dt / 1000;
  const force = -config.stiffness * (state.x - target);
  state.vx += (force - config.damping * state.vx) * dtSec;
  state.x += state.vx * dtSec;

  // The integrator stores velocity in px/s. Stop once the remaining motion is
  // below a perceptible frame instead of spending hundreds of milliseconds on
  // a sub-pixel tail.
  const settled =
    Math.abs(state.x - target) < SETTLE_DISTANCE_PX &&
    Math.abs(state.vx) < SETTLE_SPEED_PX_PER_SECOND;
  if (settled) {
    state.x = target;
    state.vx = 0;
  }
  return settled;
}

export const DEFAULT_SPRING: SpringConfig = {
  stiffness: 180,
  damping: 22,
};
