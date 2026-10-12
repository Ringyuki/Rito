import type {
  TransitionFrame,
  TransitionPoint,
  TransitionScene,
  TransitionTouch,
} from '../effects';
import { behind, curlThrough, layCurl, lineAt, type Curl, type CurlLine } from './curl';
import { easedIn, gotTo, leantBack, leantBy, shownFor, type Carried } from './curl-hold';
import type { View } from './hold';
import { GONE_BY, inTheAir, sendOff, type Leaf } from './leaves';
import { eyeHeight } from './renderer';
import { aloneBy, type LeafTurn } from './swing';

/**
 * How the picture of a curled page keeps step with its turn: what moves the
 * turn (a finger, `null`; or its own way on to turned, 1, or back to flat,
 * 0), what of the page a finger carries, and how far the turn had gone and
 * the page had got when this began: under a finger how far what it carries
 * had got, let go how far over the page was.
 */
interface Pace {
  readonly toward: 0 | 1 | null;
  readonly carries: Carried;
  readonly turned: number;
  readonly at: number;
  /** That a finger took the page lying at rest, and the first of its way is eased into. */
  readonly eased: boolean;
}

/** What a finger that took the page holds of it. */
interface Held {
  /** Where the finger came down: what tells one hold from the next. */
  readonly from: TransitionPoint;
  /** How the page leant when it was taken, and the height its lean is told from as the finger goes up or down. */
  readonly leant: number;
  readonly fromY: number;
  /** The lean it was drawn with when taken in the air, which it may keep. */
  readonly kept: number;
  /** The height the finger holds it at: where it last did, once it has let go. */
  y: number;
  /** The lean the finger asks for. */
  wanted: number;
}

/**
 * What a page curled over keeps from frame to frame beside how far over it
 * is: how its line leans, how it keeps step, and the finger's hold of it.
 */
export interface Curled {
  /** The tangent of the angle its line leans from upright by, above zero when its lower end leads. */
  lean: number;
  pace: Pace | null;
  held: Held | null;
  /** The curl it was last laid out through. */
  curl: Curl | null;
}

/** A page lying flat taken by a corner leans by this much, as a tangent. */
const BY_A_CORNER = 0.55;
/** A finger moved up or down by this many page heights leans the line by a tangent of 1. */
const LEANS_OVER = 0.8;
/** A turn this near its end, in turns of the page, has nowhere left to take its page. */
const NO_WAY_LEFT = 0.02;

/** A page curled over that has yet to be turned, held or laid out. */
export function curledFlat(): Curled {
  return { lean: 0, pace: null, held: null, curl: null };
}

/**
 * How far over a curled page should be drawn.
 *
 * Under a finger, where that puts what the finger carries. A turn is told
 * as how far the finger has gone, twice the turn's own way: that is how far
 * the edge of the paper turned over has gone at the height the finger holds
 * it, or, of a page brought back, how far its line has; the page is laid
 * out for that.
 *
 * Let go, its line goes on from where it is in step with the turn: on its
 * way to turned it is out of the frame while the turn is still slowing
 * down, and a page brought back by its line goes on no slower than the
 * finger had it, and lies flat before the turn is over. A page whose turn
 * has nowhere left to take it finishes by itself.
 */
export function wantedCurled(
  leaf: Leaf,
  curled: Curled,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: LeafTurn,
): number {
  const view = {
    width: scene.width,
    height: scene.height,
    eye: eyeHeight(scene.width, scene.height),
  };
  const toward =
    frame.phase === 'held' ? null : (frame.phase === 'landing') === read.forward ? 1 : 0;
  if (toward === null && frame.touch) hold(leaf, curled, frame.touch, read);
  // Sent on its own way, it is not the turn's to place until it has got there.
  if (leaf.flight) return leaf.shown;
  const y = curled.held?.y ?? leaf.shape.height / 2;
  const carries: Carried = frame.touch && !read.forward ? 'line' : 'edge';
  if (curled.pace?.toward !== toward || curled.pace.carries !== carries) {
    const touch = frame.touch;
    // How much of a turn the finger itself has carried: half its own way across.
    const carried = touch ? Math.abs(touch.position.x - touch.origin.x) / (2 * scene.width) : null;
    const begun = paceFrom(leaf, curled, toward, carries, read.turned, carried, y, view);
    if (!begun) {
      // The turn is at its end and the page is not: it goes the rest of the way by itself.
      sendOff(leaf, toward === 1 ? 1 : 0, aloneBy(scene.width));
      return leaf.shown;
    }
    curled.pace = begun;
  }
  const pace = curled.pace;
  const aTurn = 2 * scene.width;
  if (pace.toward !== null) return onItsWay(pace, read.turned, aTurn / leaf.shape.width);
  const reached = pace.at + aTurn * (read.turned - pace.turned);
  const got = pace.eased ? easedIn(leaf.shape, reached) : reached;
  curled.lean = leanFor(leaf, curled, pace.carries, got, y);
  return shownFor(pace.carries, leaf.shape, got, curled.lean, y, view);
}

/**
 * The finger's hold of the page, taken anew when another finger has come
 * down. A page lying flat is taken by a lower corner low on the page, by an
 * upper one high on it, by its edge between; a page in the air goes on
 * leaning as it does. From there the line leans as the finger moves up or
 * down.
 */
function hold(leaf: Leaf, curled: Curled, touch: TransitionTouch, read: LeafTurn): void {
  leaf.flight = null;
  const from = curled.held?.from;
  if (from?.x !== touch.origin.x || from.y !== touch.origin.y) {
    const atRest = !inTheAir(leaf);
    const drawn = leanOf(leaf, curled);
    const down = touch.origin.y / (leaf.shape.height || 1);
    curled.held = {
      from: touch.origin,
      leant: atRest && read.forward ? byACorner(down) : drawn,
      // A finger has moved before it takes a page in the air: its lean is told from where it took it.
      fromY: atRest ? touch.origin.y : touch.position.y,
      kept: atRest ? 0 : drawn,
      y: touch.position.y,
      wanted: 0,
    };
    // A new hold: the page goes on from where it is.
    curled.pace = null;
  }
  const held = curled.held;
  if (!held) return;
  held.y = touch.position.y;
  held.wanted =
    held.leant + (held.fromY - touch.position.y) / (leaf.shape.height || 1) / LEANS_OVER;
}

/**
 * Where a pace begins: how far the turn has gone and the page has got. A
 * page lying at rest that a finger has turned all the way the turn has
 * gone (`carried` of a turn) begins where the turn did, so nothing of the
 * finger's way is lost before the first frame; any other begins where it
 * is: a page gone from the frame with its turn still on its way lies at
 * rest too, and must not start from there. Null when the turn has nowhere
 * left to go and the page is not there.
 */
function paceFrom(
  leaf: Leaf,
  curled: Curled,
  toward: 0 | 1 | null,
  carries: Carried,
  turned: number,
  carried: number | null,
  y: number,
  view: View,
): Pace | null {
  if (toward !== null) {
    const left = toward === 1 ? 1 - turned : turned;
    if (left < NO_WAY_LEFT && Math.abs(toward - leaf.shown) > NO_WAY_LEFT) return null;
    return { toward, carries, turned, at: leaf.shown, eased: false };
  }
  const rest = Math.round(leaf.shown);
  const fresh =
    !inTheAir(leaf) && carried !== null && Math.abs(Math.abs(turned - rest) - carried) < 1e-3;
  return {
    toward,
    carries,
    turned: fresh ? rest : turned,
    at: gotTo(carries, leaf.shape, leaf.shown, curled.lean, y, view),
    eased: fresh && carries === 'edge',
  };
}

/**
 * How far over a page let go is, its turn `turned` of its way. It gets
 * there with its turn, but on its way to turned sooner, by `GONE_BY` of
 * what the turn had left; and a page a finger brought back by its line goes
 * on at the pace the finger had it, `held` of its own way to each of the
 * turn's, where that is the faster.
 */
function onItsWay(pace: Pace, turned: number, held: number): number {
  if (pace.toward === null) return pace.at;
  const way = pace.toward - pace.at;
  const left = pace.toward === 1 ? (1 - pace.turned) * GONE_BY : pace.turned;
  if (Math.abs(way) < 1e-9 || left <= 1e-6) return pace.toward;
  // A turn sent back the way it came goes on a little before it turns round, and its page with it.
  const gone = pace.toward === 1 ? turned - pace.turned : pace.turned - turned;
  const aWay = Math.max(pace.carries === 'line' ? held : 0, Math.abs(way) / left);
  const there = pace.at + way * Math.min(1, (aWay * gone) / Math.abs(way));
  return Math.min(1, Math.max(0, there));
}

/** How the page leans with what its turn carries got to `got`: as it is held, within what its shape lets it. */
function leanFor(leaf: Leaf, curled: Curled, carries: Carried, got: number, y: number): number {
  const held = curled.held;
  if (!held) return curled.lean;
  return carries === 'edge'
    ? leantBy(leaf.shape, held.wanted, got, y, held.kept)
    : leantBack(held.wanted);
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
