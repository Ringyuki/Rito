import type { TransitionPoint } from '../effects';
import type { TransitionSettle } from '../physics';
import type { Curled } from './curled';
import type { PageSnapshot } from './gl';
import type { Hold } from './hold';
import type { LeafGrab, LeafShape } from './leaf';

/** A leaf nothing leads any more, on its own way to rest. */
interface Flight {
  /** How far through its motion it is (0 lying right, 1 lying left), seconds after it was left alone. */
  readonly motion: TransitionSettle;
  elapsed: number;
  readonly to: 0 | 1;
  /** Where it was left alone. */
  readonly from: number;
}

/**
 * A page curled over is where it is going while still on the move: by this
 * share of the way it had left to go. Turned, it is out of the frame by
 * then; laid back, it lies flat. The rest of its motion is the slowing
 * down, which nobody is shown and every turn would wait for.
 */
export const GONE_BY = 0.85;

/**
 * A leaf of the book that is, or lately was, in the air. It is told from
 * every other by the spread printed on its front: turned on, turned back or
 * left to finish by itself, it is the same sheet of paper and stays where
 * it was.
 */
export interface Leaf {
  /** The spread printed on its front; the leaves of a book come in this order. */
  readonly spread: number;
  /** The bitmap of that spread it was first seen with: a leaf found again is of the same one. */
  readonly printed: unknown;
  readonly shape: LeafShape;
  /** How it is curled over, with one page a spread; null for a leaf swung about the spine. */
  readonly curled: Curled | null;
  /** The point its bend is shaped by. */
  grab: LeafGrab;
  /** What a finger holds of it, and where that finger took hold. */
  hold: Hold | null;
  heldFrom: TransitionPoint | null;
  /** How far over it is drawn: 0 lying right of the spine, 1 lying left of it. */
  shown: number;
  /** How fast that is changing, a second. */
  speed: number;
  /** How far through its motion it was, and its turn had got to, when the finger let go. */
  letGo: { readonly through: number; readonly turned: number } | null;
  front: PageSnapshot | null;
  after: PageSnapshot | null;
  flight: Flight | null;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
}

/** As near as makes no difference to lying flat. */
const AT_REST = 1e-4;
/**
 * A leaf coming down by itself has landed once it is this near flat, in
 * turns of the leaf, and slower than this a second: a pixel or so off the
 * page. A spring takes a fifth of a second more to creep the rest of the
 * way, which nobody sees and every turn would wait for.
 */
const LANDED_WITHIN = 0.001;
const LANDED_BELOW = 0.05;

export function inTheAir(leaf: Leaf): boolean {
  return leaf.shown > AT_REST && leaf.shown < 1 - AT_REST;
}

/** Puts a leaf among the others where it comes in the book. */
export function placeInBook(book: Leaf[], leaf: Leaf): void {
  const later = book.findIndex((other) => other.spread > leaf.spread);
  book.splice(later < 0 ? book.length : later, 0, leaf);
}

/**
 * Keeps the leaves from passing through each other. A leaf nearer the front
 * of the book is always at least as far over as the one behind it: where
 * the leaf being turned would pass another, it takes that one along, and
 * so on down the book either way.
 */
export function keepInOrder(book: readonly Leaf[], led: Leaf): void {
  const at = book.indexOf(led);
  for (let index = at - 1; index >= 0; index -= 1) {
    const leaf = book[index];
    const behind = book[index + 1];
    if (leaf && behind) leaf.shown = Math.max(leaf.shown, behind.shown);
  }
  for (let index = at + 1; index < book.length; index += 1) {
    const leaf = book[index];
    const before = book[index - 1];
    if (leaf && before) leaf.shown = Math.min(leaf.shown, before.shown);
  }
}

/** Whether a leaf on its own way has got where it was going. */
export function hasLanded(leaf: Leaf): boolean {
  return leaf.flight !== null && Math.abs(leaf.shown - leaf.flight.to) < AT_REST;
}

/**
 * Leaves every leaf but `led` to finish by itself. A leaf before the one
 * being turned has been turned and comes down on the left; one after it has
 * not, and goes back to the right. `motion` is how a leaf nothing holds
 * moves, from one share of its motion to another.
 */
export function leaveAlone(
  book: readonly Leaf[],
  led: Leaf,
  motion: (from: number, speed: number, to: number) => TransitionSettle,
): void {
  const at = book.indexOf(led);
  book.forEach((leaf, index) => {
    if (leaf === led) return;
    const to = index < at ? 1 : 0;
    if (leaf.flight?.to !== to) sendOff(leaf, to, motion);
  });
}

/** Moves a leaf on its own way on by `seconds`. True once it has come to rest. */
export function fly(leaf: Leaf, seconds: number): boolean {
  const flight = leaf.flight;
  if (!flight) return false;
  flight.elapsed += seconds;
  const at = flight.motion(flight.elapsed);
  // A page curled over is where it is going on the move, ahead of its own motion.
  const hurried = leaf.curled !== null && flight.from !== flight.to;
  const reached = hurried ? flight.from + (at.x - flight.from) / GONE_BY : at.x;
  const landed =
    at.done ||
    (hurried && (flight.to === 1 ? reached >= 1 : reached <= 0)) ||
    (Math.abs(flight.to - at.x) < LANDED_WITHIN && Math.abs(at.velocity) < LANDED_BELOW);
  leaf.shown = landed ? flight.to : Math.min(1, Math.max(0, reached));
  leaf.speed = landed ? 0 : at.velocity;
  return landed;
}

/**
 * Sends a leaf on its own way to lying right (0) or left (1), from where it
 * is and as fast: it goes as a leaf its turn leads does.
 */
export function sendOff(
  leaf: Leaf,
  to: 0 | 1,
  motion: (from: number, speed: number, to: number) => TransitionSettle,
): void {
  leaf.hold = null;
  leaf.heldFrom = null;
  leaf.letGo = null;
  const from = leaf.shown;
  leaf.flight = { motion: motion(from, leaf.speed, to), elapsed: 0, to, from };
}
