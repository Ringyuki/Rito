import type { TransitionFrame, TransitionScene } from '../effects';
import { behind, curlThrough, layCurl, lineAt, type Curl, type CurlLine } from './curl';
import { underFinger, type Held } from './curl-held';
import { GONE_BY, sendOff, type Leaf } from './leaves';
import { eyeHeight } from './renderer';
import { byItself, type LeafTurn } from './swing';

/**
 * How a curled page keeps step with its turn's own way: what moves the turn
 * (a finger, `null`; or its own way on to turned, 1, or back to flat, 0),
 * and how far the turn had gone and the page had got when this began: under
 * a finger how far its edge had gone, by itself how far over the page was.
 */
export interface Pace {
  readonly toward: 0 | 1 | null;
  readonly turned: number;
  readonly at: number;
  /** That a finger took the page lying at rest to turn it on, and the first of its way is eased into. */
  readonly eased: boolean;
}

/**
 * What a page curled over keeps from frame to frame beside how far over it
 * is: how its line leans, where its turn takes it, how it keeps step, and
 * the finger's hold of it.
 */
export interface Curled {
  /** The tangent of the angle its line leans from upright by, above zero when its lower end leads. */
  lean: number;
  /** Where the turn takes it as last drawn: turned, 1, or flat, 0; null under a finger. */
  toward: 0 | 1 | null;
  pace: Pace | null;
  held: Held | null;
  /** The curl it was last laid out through. */
  curl: Curl | null;
}

/** A turn this near its end, in turns of the page, has nowhere left to take its page. */
const NO_WAY_LEFT = 0.02;

/** A page curled over that has yet to be turned, held or laid out. */
export function curledFlat(): Curled {
  return { lean: 0, toward: null, pace: null, held: null, curl: null };
}

/** Whether a curled page is where its turn takes it; under a finger its turn takes it nowhere. */
export function isThere(leaf: Leaf): boolean {
  const toward = leaf.curled?.toward ?? null;
  return toward !== null && leaf.shown === toward;
}

/**
 * How far over a curled page should be drawn, `seconds` after its last
 * frame.
 *
 * Under a finger, where the finger has it: see `underFinger`.
 *
 * Let go by a finger, it finishes by itself. Where the finger had it says
 * nothing of how far its turn has gone, so the turn cannot carry it: it
 * goes on from where it is, on to turned or back to flat as its turn goes,
 * and is there while the turn is still slowing down.
 *
 * Turned by no finger, or let go where there is no page to turn to, its
 * line keeps step with the turn; on its way to turned it is out of the
 * frame while the turn is still slowing down, and a page whose turn has
 * nowhere left to take it finishes by itself.
 */
export function wantedCurled(
  leaf: Leaf,
  curled: Curled,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: LeafTurn,
  seconds: number,
): number {
  const toward =
    frame.phase === 'held' ? null : (frame.phase === 'landing') === read.forward ? 1 : 0;
  curled.toward = toward;
  if (toward === null) {
    const view = {
      width: scene.width,
      height: scene.height,
      eye: eyeHeight(scene.width, scene.height),
    };
    return underFinger(leaf, curled, scene, frame, read, view, seconds);
  }
  if (curled.held) curled.held.released = true;
  // Sent on its own way, it is not the turn's to place until it has got there: unless the
  // turn now takes it the other way.
  if (leaf.flight?.to === toward) return leaf.shown;
  leaf.flight = null;
  if (frame.touch && frame.incoming) return letGo(leaf, toward, scene);
  return inStep(leaf, curled, toward, read.turned, scene);
}

/**
 * A page a finger has let go, sent on its way to where its turn takes it:
 * from where it is, and as fast as it was going if that was the way it is
 * sent. A page still coming to its finger when it is sent back starts from
 * rest: it was not the hand that had it going on.
 */
function letGo(leaf: Leaf, toward: 0 | 1, scene: TransitionScene): number {
  if (leaf.shown === toward) return toward;
  if (leaf.speed * (toward - leaf.shown) < 0) leaf.speed = 0;
  sendOff(leaf, toward, byItself(scene));
  return leaf.shown;
}

/**
 * How far over a page no finger moves is, its turn `turned` of its way: it
 * goes on from where it was when its turn began to carry it, and gets there
 * with the turn; on its way to turned sooner, by `GONE_BY` of what the turn
 * had left.
 */
function inStep(
  leaf: Leaf,
  curled: Curled,
  toward: 0 | 1,
  turned: number,
  scene: TransitionScene,
): number {
  let pace = curled.pace;
  if (pace?.toward !== toward) {
    const left = toward === 1 ? 1 - turned : turned;
    if (left < NO_WAY_LEFT && Math.abs(toward - leaf.shown) > NO_WAY_LEFT) {
      // The turn is at its end and the page is not: it goes the rest of the way by itself.
      sendOff(leaf, toward, byItself(scene));
      return leaf.shown;
    }
    pace = { toward, turned, at: leaf.shown, eased: false };
    curled.pace = pace;
  }
  const way = toward - pace.at;
  const left = toward === 1 ? (1 - pace.turned) * GONE_BY : pace.turned;
  if (Math.abs(way) < 1e-9 || left <= 1e-6) return toward;
  // A turn sent back the way it came goes on a little before it turns round, and its page with it.
  const gone = toward === 1 ? turned - pace.turned : pace.turned - turned;
  return Math.min(1, Math.max(0, pace.at + way * Math.min(1, gone / left)));
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
