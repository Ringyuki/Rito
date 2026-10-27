import { rubberBand } from '../driver/rubber-band';
import { springSettle, type SpringConfig } from '../driver/spring';

/**
 * A motion the strip follows on its own: where it is `seconds` after it
 * began, how fast it moves, and whether it has come to rest. Offsets are
 * device pixels from the book's block start; velocities are per second.
 */
export type ScrollSimulation = (seconds: number) => {
  readonly offset: number;
  readonly velocity: number;
  readonly done: boolean;
};

/**
 * How the strip moves under a finger and after it. The built-in physics is
 * one; an app gives its own for another feel, or drives the offset itself.
 */
export interface ScrollPhysics {
  /**
   * Where a drag shows the strip: `raw` is the offset the finger alone
   * would give, `max` the last offset, `viewport` the viewport's length.
   * Inside the book the strip follows the finger; past an end it resists.
   */
  drag(raw: number, max: number, viewport: number): number;
  /** The motion a release at `velocity` from `offset` starts. */
  release(offset: number, velocity: number, max: number): ScrollSimulation;
}

/** How fast a fling slows: its velocity falls by e every 1/FRICTION seconds. */
const FRICTION = 2;
/** Below this speed (device pixels a second) a fling has stopped. */
const REST_SPEED = 8;
const BOUNCE: SpringConfig = { stiffness: 170, damping: 26 };

/**
 * A browser-like strip: it follows a drag, resists past an end like a
 * rubber band, glides after a fling, slowing exponentially, and springs
 * back to an end it was pulled or flung past.
 */
export const defaultScrollPhysics: ScrollPhysics = {
  drag(raw, max, viewport) {
    if (raw < 0) return rubberBand(raw, viewport);
    if (raw > max) return max + rubberBand(raw - max, viewport);
    return raw;
  },
  release(offset, velocity, max) {
    if (offset < 0 || offset > max) return springBack(offset, velocity, offset < 0 ? 0 : max);
    return fling(offset, velocity, max);
  },
};

function springBack(offset: number, velocity: number, to: number): ScrollSimulation {
  const spring = springSettle(BOUNCE, offset, velocity, to);
  return (seconds) => {
    const at = spring(seconds);
    // At rest the strip is at the end, not the sub-pixel short of it the
    // spring stops at.
    return at.done
      ? { offset: to, velocity: 0, done: true }
      : { offset: at.x, velocity: at.velocity, done: false };
  };
}

/** A glide from `offset` at `velocity`, springing back from an end it reaches. */
function fling(offset: number, velocity: number, max: number): ScrollSimulation {
  const glide = (seconds: number) => {
    const decay = Math.exp(-FRICTION * seconds);
    return {
      offset: offset + (velocity / FRICTION) * (1 - decay),
      velocity: velocity * decay,
    };
  };
  // When, if ever, the glide reaches the end it heads for.
  const end = velocity < 0 ? 0 : max;
  const travel = end - offset;
  const reach = velocity === 0 ? 0 : (FRICTION * travel) / velocity;
  const hits = velocity !== 0 && reach < 1 && reach > 0;
  const hitAt = hits ? -Math.log(1 - reach) / FRICTION : Infinity;
  const bounce = hits ? springBack(end, glide(hitAt).velocity, end) : undefined;
  return (seconds) => {
    if (bounce !== undefined && seconds >= hitAt) return bounce(seconds - hitAt);
    const at = glide(seconds);
    return { ...at, done: Math.abs(at.velocity) < REST_SPEED };
  };
}
