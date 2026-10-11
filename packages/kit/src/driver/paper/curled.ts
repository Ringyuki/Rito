import type { TransitionFrame, TransitionScene } from '../effects';
import { behind, curlThrough, layCurl, lineAt, type Curl, type CurlLine } from './curl';
import { GONE_BY, inTheAir, type Leaf } from './leaves';
import type { LeafTurn } from './swing';

/**
 * How the picture of a curled page keeps step with its turn: what moves the
 * turn (a finger, `null`; or its own way on to turned, 1, or back to flat,
 * 0), and how far the turn had gone and the page was shown when that began.
 */
interface Pace {
  readonly toward: 0 | 1 | null;
  readonly turned: number;
  readonly shown: number;
}

/**
 * What a page curled over keeps from frame to frame beside how far over it
 * is: how its line leans, and how it keeps step. Nothing of it depends on
 * where a finger is: the finger moves the turn, and the turn the page.
 */
export interface Curled {
  /** The tangent of the angle its line leans from upright by, above zero when its lower end leads. */
  lean: number;
  /** The lean it had when the finger holding it took hold. */
  leantAt: number;
  pace: Pace | null;
  /** The curl it was last laid out through. */
  curl: Curl | null;
}

/** A page lying flat taken by a corner leans by this much, as a tangent. */
const BY_A_CORNER = 0.55;
/** A finger moved up or down by this many page heights leans the line by a tangent of 1. */
const LEANS_OVER = 0.8;

/** A page curled over that has yet to be turned, held or laid out. */
export function curledFlat(): Curled {
  return { lean: 0, leantAt: 0, pace: null, curl: null };
}

/**
 * How far over a curled page should be drawn. Under a finger it moves as
 * the turn does, so that its lifted edge goes as far as the finger. Let go
 * to come back, it comes back in step with the turn. On its way to turned
 * it is out of the frame while the turn is still slowing down.
 */
export function wantedCurled(
  leaf: Leaf,
  curled: Curled,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: LeafTurn,
): number {
  lean(leaf, curled, scene, frame);
  const toward =
    frame.phase === 'held' ? null : (frame.phase === 'landing') === read.forward ? 1 : 0;
  if (curled.pace?.toward !== toward) {
    curled.pace = { toward, turned: read.turned, shown: leaf.shown };
  }
  const from = curled.pace;
  let wanted: number;
  if (from.toward === null) {
    wanted = from.shown + read.turned - from.turned;
  } else if (from.toward === 1) {
    const gone = from.turned + (1 - from.turned) * GONE_BY;
    const left = gone - from.turned;
    wanted = left <= 1e-6 ? 1 : 1 - ((1 - from.shown) * (gone - read.turned)) / left;
  } else {
    wanted = from.turned <= 1e-6 ? 0 : (from.shown * read.turned) / from.turned;
  }
  return Math.min(1, Math.max(0, wanted));
}

/**
 * How the page's line leans. A finger that takes a page lying flat takes it
 * by a lower corner low on the page, by an upper one high on it, by its
 * edge between; a page already in the air goes on leaning as it does. From
 * there the line leans as the finger moves up or down. Let go, it keeps its
 * lean, and stands upright by itself as it nears the spine.
 */
function lean(leaf: Leaf, curled: Curled, scene: TransitionScene, frame: TransitionFrame): void {
  const touch = frame.touch;
  if (!touch || frame.phase !== 'held') return;
  const from = leaf.heldFrom;
  if (from?.x !== touch.origin.x || from.y !== touch.origin.y) {
    leaf.heldFrom = touch.origin;
    curled.leantAt = inTheAir(leaf)
      ? leanOf(leaf, curled)
      : byACorner(touch.origin.y / (scene.height || 1));
    // A new hold: the page goes on from where it is.
    curled.pace = null;
  }
  const moved = (touch.origin.y - touch.position.y) / (scene.height || 1);
  curled.lean = curled.leantAt + moved / LEANS_OVER;
}

/** How the page's line leans as it is drawn: no more than the spine lets it. */
function leanOf(leaf: Leaf, curled: Curled): number {
  const line = lineAt(leaf.shape, leaf.shown, curled.lean);
  return (line.top - line.bottom) / leaf.shape.height;
}

function byACorner(down: number): number {
  const off = Math.min(1, Math.max(-1, 2 * down - 1));
  const t = Math.min(1, Math.max(0, (Math.abs(off) - 0.2) / 0.7));
  return Math.sign(off) * BY_A_CORNER * t * t * (3 - 2 * t);
}

/**
 * Lays out every curled page of `book`, front of the book first. A page
 * lies under the ones before it, so its line is nowhere nearer the spine
 * than theirs: it lifts only where they have.
 */
export function layCurled(book: readonly Leaf[], columns: number, rows: number): void {
  let front: CurlLine | null = null;
  for (const leaf of book) {
    if (!leaf.curled) continue;
    const own = lineAt(leaf.shape, leaf.shown, leaf.curled.lean);
    const line: CurlLine = front ? behind(own, front) : own;
    front = line;
    leaf.curled.curl = curlThrough(leaf.shape, line);
    layCurl(leaf.shape, leaf.curled.curl, columns, rows, leaf.positions, leaf.normals);
  }
}
