import type { TransitionPoint } from '../effects';
import type { TransitionSettle } from '../physics';
import type { PageSnapshot } from './gl';
import type { Hold } from './hold';
import type { LeafGrab, LeafShape } from './leaf';

/** A leaf nothing leads any more, on its own way to rest. */
interface Flight {
  /** How far through its motion it is (0 lying right, 1 lying left), seconds after it was left alone. */
  readonly motion: TransitionSettle;
  elapsed: number;
  readonly to: 0 | 1;
}

/**
 * With one page a spread a leaf is out of sight once it is just past
 * upright, at the frame's left edge: `OUT_OF_SIGHT` of the way over. The
 * turn spends `IN_SIGHT` of itself getting there and the rest swinging on
 * down, unseen, which takes the leaf's shadow off the page with it.
 */
export const OUT_OF_SIGHT = 0.53;
const IN_SIGHT = 0.9;

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
  /** Whether it leaves the frame as it turns: a spread of one page. */
  readonly leaves: boolean;
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

/**
 * How far over the leaf is when it is `through` its motion (0–1). A leaf
 * that stays in the frame swings evenly. One that leaves it takes most of
 * its motion to get out of sight and the last of it to swing on down.
 */
export function swungAt(leaf: Leaf, through: number): number {
  if (!leaf.leaves) return through;
  return through <= IN_SIGHT
    ? (through / IN_SIGHT) * OUT_OF_SIGHT
    : OUT_OF_SIGHT + ((through - IN_SIGHT) / (1 - IN_SIGHT)) * (1 - OUT_OF_SIGHT);
}

/** How far through its motion a leaf `shown` of the way over is. */
export function throughAt(leaf: Leaf, shown: number): number {
  if (!leaf.leaves) return shown;
  return shown <= OUT_OF_SIGHT
    ? (shown / OUT_OF_SIGHT) * IN_SIGHT
    : IN_SIGHT + ((shown - OUT_OF_SIGHT) / (1 - OUT_OF_SIGHT)) * (1 - IN_SIGHT);
}

/** How fast a leaf goes through its motion for each turn a second it swings at, where it is. */
function paceAt(leaf: Leaf): number {
  if (!leaf.leaves) return 1;
  return leaf.shown <= OUT_OF_SIGHT ? IN_SIGHT / OUT_OF_SIGHT : (1 - IN_SIGHT) / (1 - OUT_OF_SIGHT);
}

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
  const landed =
    at.done || (Math.abs(flight.to - at.x) < LANDED_WITHIN && Math.abs(at.velocity) < LANDED_BELOW);
  leaf.shown = landed ? flight.to : swungAt(leaf, Math.min(1, Math.max(0, at.x)));
  leaf.speed = landed ? 0 : at.velocity / paceAt(leaf);
  return landed;
}

/**
 * Sends a leaf on its own way to lying right (0) or left (1), from where it
 * is and as fast. It goes as a leaf its turn leads does: one that leaves the
 * frame is soon out of sight and takes little longer to come down unseen.
 */
export function sendOff(
  leaf: Leaf,
  to: 0 | 1,
  motion: (from: number, speed: number, to: number) => TransitionSettle,
): void {
  leaf.hold = null;
  leaf.heldFrom = null;
  leaf.letGo = null;
  const from = throughAt(leaf, leaf.shown);
  leaf.flight = { motion: motion(from, leaf.speed * paceAt(leaf), to), elapsed: 0, to };
}
