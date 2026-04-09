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

  // Snap when close enough
  const settled = Math.abs(state.x - target) < 0.5 && Math.abs(state.vx) < 0.05;
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
