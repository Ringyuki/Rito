import { layCurled } from './curled';
import { layLeaf, poseAt } from './leaf';
import { fly, hasLanded, keepInOrder, type Leaf } from './leaves';

/** How fast a leaf is brought to where it is wanted at most, in turns per second: what a jump of the hand becomes. */
const FASTEST = 9;
/** How many leaves may be coming down by themselves; one more and the first left lands at once. */
const ALONE_AT_MOST = 3;

/**
 * Moves every leaf of `book` on by a frame: the led one toward how far over
 * it is `wanted`, every other on its own way. Those that have come to rest,
 * and any more than may be in the air at once, are taken out of the book
 * and returned. `atOnce` is for a page that is where a finger has it: it
 * is laid for the finger, and goes wherever the finger does.
 */
export function moveOn(
  book: Leaf[],
  led: Leaf,
  wanted: number,
  ledSeconds: number,
  seconds: number,
  atOnce = false,
): Leaf[] {
  if (led.flight) {
    // Let go with nowhere left for its turn to take it, it comes down by itself.
    if (fly(led, seconds)) led.flight = null;
  } else {
    const reach = atOnce ? Infinity : FASTEST * ledSeconds;
    const before = led.shown;
    led.shown += Math.min(reach, Math.max(-reach, wanted - led.shown));
    if (ledSeconds > 0) led.speed = (led.shown - before) / ledSeconds;
  }

  for (const leaf of book) if (leaf !== led) fly(leaf, seconds);
  // Pages curled over are kept apart where they are laid out, by the lines they leave the page at.
  if (!led.curled) keepInOrder(book, led);
  const landed = book.filter((leaf) => leaf !== led && hasLanded(leaf));
  const alone = book.filter((leaf) => leaf !== led && !landed.includes(leaf));
  // More in the air than can be: the one left alone longest lands at once.
  alone.sort((a, b) => (b.flight?.elapsed ?? 0) - (a.flight?.elapsed ?? 0));
  const out = [...landed, ...alone.slice(ALONE_AT_MOST)];
  for (const leaf of out) book.splice(book.indexOf(leaf), 1);
  return out;
}

/**
 * Moves the leaves on by a frame as a turn's frame has them: the led one
 * toward how far over it is `wanted`, and returns those that are done. A
 * leaf first seen this frame lies where its turn starts from. A page under
 * a finger is where the finger has it: brought there in its first frame as
 * fast as a jump of the hand may be, for the finger may have gone far
 * before its page was ready, and at once after.
 */
export function bring(
  book: Leaf[],
  led: Leaf,
  wanted: number,
  held: boolean,
  first: boolean,
  seconds: number,
): Leaf[] {
  const taken = led.curled !== null && held;
  return moveOn(book, led, wanted, first && !taken ? 0 : seconds, seconds, taken && !first);
}

/** Lays every leaf of `book` out where it now is, on a grid of `columns` by `rows`. */
export function layOut(book: readonly Leaf[], columns: number, rows: number): void {
  layCurled(book, columns, rows);
  for (const leaf of book) {
    if (leaf.curled) continue;
    const pose = poseAt(leaf.shape, leaf.grab, leaf.shown);
    layLeaf(leaf.shape, pose, columns, rows, leaf.positions, leaf.normals);
  }
}
