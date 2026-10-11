import type { TransitionTouch } from '../effects';
import type { TransitionBounds, TransitionPhysics } from '../physics';
import { springSettle } from '../spring';

/** The point of the sheet a hand holds: `u` from the spine outward, `v` from the top down. */
export interface PaperGrab {
  readonly u: number;
  readonly v: number;
}

/** A hand takes the sheet no nearer the spine than this share of its width. */
const NEAREST_GRAB = 0.35;
/** Where a turn no finger started takes the sheet: by its lower outer corner. */
const UNHELD_GRAB: PaperGrab = { u: 1, v: 1 };
/** A page takes its time: slower than the built-in spring, and never past its target. */
const PAPER_SPRING = { stiffness: 110, damping: 21 };
/**
 * A turn let go slower than this many of its remaining lengths a second is
 * carried by an unhurried hand: it lifts, swings and sets down. A faster
 * one keeps its momentum, on the spring.
 */
const UNHURRIED = 0.8;
/** A finger must have moved this far, CSS px, for letting go to turn the page. */
const LEAST_PULL = 24;
/** How long past the hand's arrival the turn waits for the paper to lie flat, seconds. */
const LONGEST_WAIT = 0.4;

/**
 * Which point of the sheet a finger took hold of. A finger moving toward
 * the next spread takes the sheet lying right of the spine where it went
 * down; one moving back takes the sheet lying left of it, or, when a spread
 * is one page and that sheet is out of sight, its outer edge.
 */
export function grabOf(
  touch: TransitionTouch | null,
  bounds: TransitionBounds & { readonly height: number },
): PaperGrab {
  if (!touch) return UNHELD_GRAB;
  const sheet = bounds.width - bounds.spine;
  const back = touch.position.x > touch.origin.x;
  const out = back
    ? bounds.spine > 0
      ? bounds.spine - touch.origin.x
      : sheet
    : touch.origin.x - bounds.spine;
  return {
    u: Math.min(1, Math.max(NEAREST_GRAB, out / (sheet || 1))),
    v: Math.min(1, Math.max(0, touch.origin.y / (bounds.height || 1))),
  };
}

export interface PaperPhysicsHost {
  /** Whether the paper on screen has reached where its turn wants it; true when none is drawn. */
  arrived(): boolean;
}

/**
 * How a paper turn moves. A whole turn carries the held point from one side
 * of the spine to the same distance on the other, so the point stays under
 * the finger; a page takes longer to land than a slide does; and the turn
 * is over when the paper has come to lie flat.
 */
export function createPaperPhysics(host: PaperPhysicsHost): TransitionPhysics {
  return {
    travel(touch, bounds) {
      const moved = touch.position.x - touch.origin.x;
      if (moved === 0) return 0;
      const grab = grabOf(touch, { ...bounds, height: 1 });
      const radius = grab.u * (bounds.width - bounds.spine);
      if (moved < 0) return -bounds.width * Math.min(1, -moved / (2 * radius));
      // Turning back: the sheet comes over the spine to meet the finger.
      const turned =
        bounds.spine > 0
          ? 1 - moved / (2 * radius)
          : (bounds.spine + radius - touch.position.x) / (2 * radius);
      return bounds.width * Math.min(1, Math.max(0, 1 - turned));
    },

    lands({ dx, velocity, width, direction, touch }) {
      const toward = direction === 'forward' ? -1 : 1;
      const along = Math.max(0, (dx * toward) / (width || 1));
      const speed = (velocity * toward) / (width || 1);
      const pulled = touch ? (touch.position.x - touch.origin.x) * toward : Infinity;
      // Pulling back, or barely moved: the page stays.
      if (speed < -0.25 || pulled < LEAST_PULL) return false;
      return along + speed * 0.15 > 0.2 || speed > 1;
    },

    settle(from, velocity, to) {
      const spring =
        Math.abs(velocity) < UNHURRIED * Math.abs(to - from)
          ? unhurried(from, to)
          : springSettle(PAPER_SPRING, from, velocity, to);
      let arrivedAt: number | null = null;
      return (seconds) => {
        const at = spring(seconds);
        if (!at.done) return at;
        arrivedAt ??= seconds;
        // The hand is there, exactly; the paper it carries follows a moment behind.
        return { x: to, velocity: 0, done: host.arrived() || seconds - arrivedAt > LONGEST_WAIT };
      };
    },
  };
}

/**
 * From `from` to `to`, starting and stopping gently: the longer the way,
 * the longer it takes, from a third of a second to two thirds.
 */
function unhurried(from: number, to: number): ReturnType<typeof springSettle> {
  const duration = Math.min(0.66, 0.32 + Math.abs(to - from) / 1100);
  return (seconds) => {
    const t = Math.min(1, seconds / duration);
    const eased = t * t * (3 - 2 * t);
    const speed = (6 * t * (1 - t)) / duration;
    return { x: from + (to - from) * eased, velocity: (to - from) * speed, done: t >= 1 };
  };
}
