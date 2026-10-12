import type { TransitionTouch } from '../effects';
import type { TransitionBounds, TransitionPhysics, TransitionSettle } from '../physics';
import { springSettle } from '../spring';
import { NEAREST_HOLD } from './hold';
import type { LeafGrab } from './leaf';

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
/** How long a leaf sent back the way it came takes to stop, seconds. */
const STOPS_IN = 0.1;
/** A finger must have moved this far, CSS px, for letting go to turn the page. */
const LEAST_PULL = 24;

/**
 * Which point of the leaf a finger took hold of. A finger moving toward
 * the next spread takes the leaf lying right of the spine where it went
 * down; one moving back takes the leaf lying left of it. With one page a
 * spread the page is curled over from its outer edge, wherever the finger
 * went down.
 */
export function grabOf(
  touch: TransitionTouch | null,
  bounds: TransitionBounds & { readonly height: number },
): LeafGrab {
  if (!touch) return UNHELD_GRAB;
  const leaf = bounds.width - bounds.spine;
  const back = touch.position.x > touch.origin.x;
  const out =
    bounds.spine > 0
      ? back
        ? bounds.spine - touch.origin.x
        : touch.origin.x - bounds.spine
      : leaf;
  return {
    u: Math.min(1, Math.max(NEAREST_HOLD, out / (leaf || 1))),
    v: Math.min(1, Math.max(0, touch.origin.y / (bounds.height || 1))),
  };
}

/** What the effect tells of the page a turn is of, beyond whether a leaf is still in the air. */
export interface PaperPicture {
  /** How many frames have been painted. */
  painted(): number;
  /** Whether that page is where its turn takes it, with the turn still on its way. */
  there(): boolean;
  /** Whether it has left the frame for good. */
  gone(): boolean;
}

/**
 * How a paper turn moves. A whole turn carries the held point from one side
 * of the spine to the same distance on the other, so the point stays under
 * the finger; a leaf turned by no finger starts at once and lands softly in
 * well under half a second; and the last frame drawn is the leaf lying
 * exactly where it lands.
 *
 * A turn that cuts into another takes up the same leaf when it is that leaf
 * turned again, and otherwise lifts the next one from flat: the leaf it cut
 * into is the effect's to bring down, and `aloft` says whether one still is
 * in the air, for no turn is over before every leaf has come to rest. A
 * page curled over is out of the frame, or lying flat again, while its turn
 * is still slowing down; `picture` says when it is, and the turn is over a
 * frame later.
 */
export function createPaperPhysics(
  aloft: () => boolean = () => false,
  picture: PaperPicture = { painted: () => 0, there: () => false, gone: () => false },
): TransitionPhysics {
  return {
    travel(touch, bounds) {
      const moved = touch.position.x - touch.origin.x;
      if (moved === 0) return 0;
      const grab = grabOf(touch, { ...bounds, height: 1 });
      // The held point goes as far as the finger, and a whole turn takes it twice its distance from the spine.
      const radius = grab.u * (bounds.width - bounds.spine);
      return bounds.width * Math.min(1, Math.max(-1, moved / (2 * radius)));
    },

    lands({ dx, from, velocity, width, direction, touch }) {
      const toward = direction === 'forward' ? -1 : 1;
      // How far the finger carried the leaf, wherever it took it.
      const along = Math.max(0, ((dx - from) * toward) / (width || 1));
      const speed = (velocity * toward) / (width || 1);
      const pulled = touch ? (touch.position.x - touch.origin.x) * toward : Infinity;
      // Pulling back, or barely moved: the page stays.
      if (speed < -0.25 || pulled < LEAST_PULL) return false;
      return along + speed * 0.15 > 0.2 || speed > 1;
    },

    begins({ dx, velocity, sameSpreads }) {
      if (!sameSpreads) return { dx: 0, velocity: 0 };
      // A page already out of the frame has nothing left to carry on with: it is brought back at once.
      return { dx, velocity: picture.gone() ? 0 : velocity };
    },

    settle(from, velocity, to) {
      const motion = leafMotion(from, velocity, to);
      const began = picture.painted();
      let shown = false;
      return (seconds) => {
        const at = motion(seconds);
        if (at.done) return aloft() ? { ...at, done: false } : at;
        // The page has got there: one frame is drawn of that, and the turn is over.
        if (picture.painted() > began && picture.there() && !aloft()) {
          const done = shown;
          shown = true;
          return { x: to, velocity: 0, done };
        }
        return at;
      };
    },
  };
}

/**
 * How a leaf nothing holds goes from `from` at `velocity` to `to`: at its
 * own pace when it is slow, keeping its momentum when it is not, and with
 * one frame drawn exactly where it lands before it is done.
 */
export function leafMotion(from: number, velocity: number, to: number): TransitionSettle {
  const motion = motionOf(from, velocity, to);
  let landed = false;
  return (seconds) => {
    const at = motion(seconds);
    if (!at.done) return at;
    const done = landed;
    landed = true;
    return { x: to, velocity: 0, done };
  };
}

function motionOf(from: number, velocity: number, to: number): TransitionSettle {
  const way = to - from;
  // Already there: a spring would carry what speed it had past the page and creep back.
  if (Math.abs(way) < 0.5) return () => ({ x: to, velocity: 0, done: true });
  if (velocity * way < 0 && Math.abs(velocity) > UNHURRIED * Math.abs(way)) {
    return turnedRound(from, velocity, to);
  }
  return Math.abs(velocity) < UNHURRIED * Math.abs(way)
    ? unhurried(from, to)
    : springSettle(LEAF_SPRING, from, velocity, to);
}

/**
 * A leaf sent back the way it came while still on the move: it carries on,
 * slowing evenly to a stop in `STOPS_IN`, and comes back from there at its
 * own pace. Turned round by a spring it would be going the other way a
 * frame later, as if it had struck something.
 */
function turnedRound(from: number, velocity: number, to: number): TransitionSettle {
  const stop = from + (velocity * STOPS_IN) / 2;
  const back = unhurried(stop, to);
  return (seconds) => {
    if (seconds >= STOPS_IN) return back(seconds - STOPS_IN);
    const slowed = 1 - seconds / STOPS_IN;
    return {
      x: stop - (velocity * STOPS_IN * slowed * slowed) / 2,
      velocity: velocity * slowed,
      done: false,
    };
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
