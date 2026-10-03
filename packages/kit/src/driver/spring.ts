/**
 * A damped harmonic oscillator (unit mass) toward a target:
 *   x'' = -stiffness * (x - target) - damping * x'
 *
 * Each step evaluates the closed-form solution from the current state, so
 * the trajectory is exact and the same whatever the frame rate.
 */

export interface SpringState {
  x: number;
  vx: number;
}

export interface SpringConfig {
  readonly stiffness: number;
  readonly damping: number;
}

// Settle once what motion remains is sub-pixel: within half a pixel of the
// target, and not moving fast enough to carry more than half a pixel
// further (|v| / ω). A coarser cut (4px / 300px/s) once chopped the
// spring's tail and every page turn ended with a visible snap.
const SETTLE_DISTANCE_PX = 0.5;

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
  const offset = state.x - target;
  const next = springAt(config, offset, boundedVelocity(config, offset, state.vx), dt / 1000);
  state.x = target + next.offset;
  state.vx = next.velocity;

  const settled =
    Math.abs(state.x - target) < SETTLE_DISTANCE_PX &&
    Math.abs(state.vx) / Math.sqrt(config.stiffness) < SETTLE_DISTANCE_PX;
  if (settled) {
    state.x = target;
    state.vx = 0;
  }
  return settled;
}

/**
 * A spring that does not oscillate (damping at or above critical) passes
 * its target only when it starts toward it faster than ω times the
 * distance; at that speed or below it arrives without crossing. Bounding a
 * handed-over velocity there keeps such a spring on its side of the target
 * — past it there is nothing to show — while the motion stays continuous.
 * An oscillating spring is left as configured: it was chosen to bounce.
 */
function boundedVelocity(config: SpringConfig, offset: number, velocity: number): number {
  const omega = Math.sqrt(config.stiffness);
  if (config.damping < 2 * omega || offset === 0) return velocity;
  const limit = omega * Math.abs(offset);
  const toward = -Math.sign(offset) * velocity;
  return toward > limit ? -Math.sign(offset) * limit : velocity;
}

/** The spring's offset from its target and velocity `t` seconds on. */
export function springAt(
  config: SpringConfig,
  offset: number,
  velocity: number,
  t: number,
): { offset: number; velocity: number } {
  const omega = Math.sqrt(config.stiffness);
  const zeta = config.damping / (2 * omega);
  if (Math.abs(zeta - 1) < 1e-6) {
    const c = velocity + omega * offset;
    const decay = Math.exp(-omega * t);
    return {
      offset: (offset + c * t) * decay,
      velocity: (velocity - omega * c * t) * decay,
    };
  }
  if (zeta < 1) {
    const a = zeta * omega;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    const c = (velocity + a * offset) / wd;
    const decay = Math.exp(-a * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return {
      offset: decay * (offset * cos + c * sin),
      velocity: decay * ((c * wd - a * offset) * cos - (offset * wd + a * c) * sin),
    };
  }
  const root = omega * Math.sqrt(zeta * zeta - 1);
  const slow = -zeta * omega + root;
  const fast = -zeta * omega - root;
  const slowPart = (velocity - fast * offset) / (slow - fast);
  const fastPart = offset - slowPart;
  const slowDecay = Math.exp(slow * t);
  const fastDecay = Math.exp(fast * t);
  return {
    offset: slowPart * slowDecay + fastPart * fastDecay,
    velocity: slow * slowPart * slowDecay + fast * fastPart * fastDecay,
  };
}
