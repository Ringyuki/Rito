import type { TransitionTouch } from '../effects';
import type { TransitionBounds, TransitionPhysics, TransitionSettle } from '../physics';
import { springSettle } from '../spring';
import type { LeafGrab } from './leaf';

/** A hand takes the leaf no nearer the spine than this share of its width. */
const NEAREST_GRAB = 0.35;
/** Where a turn no finger started takes the leaf: its outer edge, toward the lower corner. */
const UNHELD_GRAB: LeafGrab = { u: 1, v: 0.86 };
/** A leaf let go on the move finishes on this spring: quick, and never past its target. */
const LEAF_SPRING = { stiffness: 260, damping: 32.3 };
/** How long a leaf turned by no finger takes, seconds: the whole way, and a nudge of it. */
const WHOLE_TURN = 0.38;
const SHORTEST_TURN = 0.2;
/**
 * A turn let go slower than this many of its remaining lengths a second is
 * finished at the leaf's own pace; a faster one keeps its momentum.
 */
const UNHURRIED = 1.2;
/** A finger must have moved this far, CSS px, for letting go to turn the page. */
const LEAST_PULL = 24;

/**
 * Which point of the leaf a finger took hold of. A finger moving toward
 * the next spread takes the leaf lying right of the spine where it went
 * down; one moving back takes the leaf lying left of it, or, when a spread
 * is one page and that leaf is out of sight, its outer edge.
 */
export function grabOf(
  touch: TransitionTouch | null,
  bounds: TransitionBounds & { readonly height: number },
): LeafGrab {
  if (!touch) return UNHELD_GRAB;
  const leaf = bounds.width - bounds.spine;
  const back = touch.position.x > touch.origin.x;
  const out = back
    ? bounds.spine > 0
      ? bounds.spine - touch.origin.x
      : leaf
    : touch.origin.x - bounds.spine;
  return {
    u: Math.min(1, Math.max(NEAREST_GRAB, out / (leaf || 1))),
    v: Math.min(1, Math.max(0, touch.origin.y / (bounds.height || 1))),
  };
}

/**
 * How a paper turn moves. A whole turn carries the held point from one side
 * of the spine to the same distance on the other, so the point stays under
 * the finger; a leaf turned by no finger starts at once and lands softly in
 * well under half a second; and the last frame drawn is the leaf lying
 * exactly where it lands.
 */
export function createPaperPhysics(): TransitionPhysics {
  return {
    travel(touch, bounds) {
      const moved = touch.position.x - touch.origin.x;
      if (moved === 0) return 0;
      const grab = grabOf(touch, { ...bounds, height: 1 });
      const radius = grab.u * (bounds.width - bounds.spine);
      if (moved < 0) return -bounds.width * Math.min(1, -moved / (2 * radius));
      // Turning back: the leaf comes over the spine to meet the finger.
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
      const motion =
        Math.abs(velocity) < UNHURRIED * Math.abs(to - from)
          ? unhurried(from, to)
          : springSettle(LEAF_SPRING, from, velocity, to);
      // One frame is drawn with the leaf exactly where it lands before the turn is over.
      let landed = false;
      return (seconds) => {
        const at = motion(seconds);
        if (!at.done) return at;
        const done = landed;
        landed = true;
        return { x: to, velocity: 0, done };
      };
    },
  };
}

/**
 * From `from` to `to` at the leaf's own pace: off at once, fastest early,
 * slowing all the way in. The whole way across takes `WHOLE_TURN`; a
 * shorter way takes less, but not less than `SHORTEST_TURN`.
 */
function unhurried(from: number, to: number): TransitionSettle {
  const share = Math.min(1, Math.abs(to - from) / 800);
  const duration = SHORTEST_TURN + (WHOLE_TURN - SHORTEST_TURN) * share;
  return (seconds) => {
    const t = Math.min(1, seconds / duration);
    // A smooth step taken early: two thirds of the way by half time.
    const early = t ** 0.72;
    const eased = early * early * (3 - 2 * early);
    const speed = (6 * early * (1 - early) * 0.72 * t ** -0.28) / duration;
    return {
      x: from + (to - from) * eased,
      velocity: t > 0 ? (to - from) * speed : 0,
      done: t >= 1,
    };
  };
}
