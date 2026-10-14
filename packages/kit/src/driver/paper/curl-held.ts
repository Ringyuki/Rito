/**
 * A curled page under a finger.
 *
 * Until the finger has plainly set off, the page is drawn for the finger's
 * own way: the edge of its paper turned over goes as far as the finger has,
 * from where it was when it was taken, so a finger that only slips lifts
 * next to nothing and a page taken in the air stays where it is. Once the
 * finger has set off the way the turn goes, that edge comes to the finger,
 * at the height the finger is at, and stays under it: turned on or brought
 * back, wherever on the page the finger came down.
 */
import type {
  TransitionFrame,
  TransitionPoint,
  TransitionScene,
  TransitionTouch,
} from '../effects';
import { lineAt } from './curl';
import { easedIn, gotTo, leantBy, shownFor, stillShort } from './curl-hold';
import type { Curled, Pace } from './curled';
import type { View } from './hold';
import { inTheAir, type Leaf } from './leaves';
import { LEAST_PULL } from './paper-physics';
import type { LeafTurn } from './swing';

/** A page lying flat taken by a corner leans by this much, as a tangent. */
const BY_A_CORNER = 0.55;
/** A finger moved up or down by this many page heights leans the line by a tangent of 1. */
const LEANS_OVER = 0.8;
/** A page whose edge is this near its finger, CSS px, is with it. */
const WITH_IT = 0.5;

/**
 * A page on its way to the finger that has set off with it: what it was
 * short of the finger by then, in how far its edge had gone and in how it
 * leant, and how long it has been coming.
 */
interface Coming {
  readonly edge: number;
  readonly lean: number;
  seconds: number;
}

/** What a finger that took the page holds of it. */
export interface Held {
  /** Where the finger came down: what tells one hold from the next. */
  readonly from: TransitionPoint;
  /** How the page leant when it was taken, and the height its lean is told from as the finger goes up or down. */
  readonly leant: number;
  readonly fromY: number;
  /** The lean it was drawn with when taken in the air, which it may keep. */
  readonly kept: number;
  /** The height the finger holds it at. */
  y: number;
  /** The lean the finger asks for. */
  wanted: number;
  /** That the finger has gone far enough the way the turn goes to mean it. */
  setOff: boolean;
  /** The page's way to the finger since then; null before, and for a page that was past its finger. */
  coming: Coming | null;
  /** That the finger has let go: whatever takes the page next takes it anew. */
  released: boolean;
}

/** Whether the finger of `frame` is the one that already holds the page. */
export function stillHeld(curled: Curled | null, frame: TransitionFrame): boolean {
  const held = curled?.held;
  const touch = frame.touch;
  if (!held || !touch || held.released || frame.phase !== 'held') return false;
  return held.from.x === touch.origin.x && held.from.y === touch.origin.y;
}

/**
 * How far over a curled page under a finger should be drawn: for the
 * finger's own way until the finger has set off, and from then with its
 * edge coming to the finger. With no finger told of, for the turn's own
 * way alone.
 */
export function underFinger(
  leaf: Leaf,
  curled: Curled,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: LeafTurn,
  view: View,
  seconds: number,
): number {
  const touch = frame.touch;
  const held = touch ? hold(leaf, curled, frame, touch, read) : null;
  // Sent on its own way with no finger to take it, it is left to that.
  if (!held && leaf.flight) return leaf.shown;
  const y = curled.held?.y ?? leaf.shape.height / 2;
  let pace = curled.pace;
  if (pace?.toward !== null) {
    pace = takenAt(leaf, curled, scene, touch, read, y, view);
    curled.pace = pace;
  }
  const reached = pace.at + 2 * scene.width * (read.turned - pace.turned);
  const own = pace.eased ? easedIn(leaf.shape, reached) : reached;
  if (!held || !touch) return shownFor(leaf.shape, own, curled.lean, y, view);
  const got = broughtTo(leaf, held, scene, frame, touch, read, own, seconds);
  curled.lean = got.lean;
  return shownFor(leaf.shape, got.edge, got.lean, y, view);
}

/**
 * The finger's hold of the page, taken anew when another finger has come
 * down, when this one had let go, and when the page has been left to
 * itself since. A page lying flat that is turned on is taken by a lower
 * corner low on the page, by an upper one high on it, by its edge between;
 * any other goes on leaning as it does. From there the line leans as the
 * finger moves up or down.
 */
function hold(
  leaf: Leaf,
  curled: Curled,
  frame: TransitionFrame,
  touch: TransitionTouch,
  read: LeafTurn,
): Held {
  leaf.flight = null;
  let held = curled.held;
  if (!held || !stillHeld(curled, frame) || curled.pace?.toward !== null) {
    const atRest = !inTheAir(leaf);
    const drawn = leanOf(leaf, curled);
    const down = touch.origin.y / (leaf.shape.height || 1);
    held = {
      from: touch.origin,
      leant: atRest && read.forward ? byACorner(down) : drawn,
      // A finger has moved before it takes a page in the air: its lean is told from where it took it.
      fromY: atRest ? touch.origin.y : touch.position.y,
      kept: atRest ? 0 : drawn,
      y: touch.position.y,
      wanted: 0,
      setOff: false,
      coming: null,
      released: false,
    };
    curled.held = held;
    // A new hold: the page goes on from where it is.
    curled.pace = null;
  }
  held.y = touch.position.y;
  held.wanted =
    held.leant + (held.fromY - touch.position.y) / (leaf.shape.height || 1) / LEANS_OVER;
  return held;
}

/**
 * Where the finger's own way begins from: how far the turn has gone and the
 * page's edge has got. A page lying at rest that a finger has turned all
 * the way the turn has gone begins where the turn did, so nothing of the
 * finger's way is lost before the first frame, and turned on the first of
 * that way is eased into; any other begins where it is: a page gone from
 * the frame with its turn still on its way lies at rest too, and must not
 * start from there.
 */
function takenAt(
  leaf: Leaf,
  curled: Curled,
  scene: TransitionScene,
  touch: TransitionTouch | null,
  read: LeafTurn,
  y: number,
  view: View,
): Pace {
  const rest = Math.round(leaf.shown);
  // How much of a turn the finger itself has carried: half its own way across.
  const carried = touch ? Math.abs(touch.position.x - touch.origin.x) / (2 * scene.width) : null;
  const fresh =
    !inTheAir(leaf) && carried !== null && Math.abs(Math.abs(read.turned - rest) - carried) < 1e-3;
  return {
    toward: null,
    turned: fresh ? rest : read.turned,
    at: gotTo(leaf.shape, leaf.shown, curled.lean, y, view),
    eased: fresh && read.forward,
  };
}

/**
 * How far the page's edge has gone and how the page leans, when the
 * finger's own way would have its edge `own` gone.
 *
 * The finger has set off once it has gone `LEAST_PULL` the way the turn
 * goes, with a page to turn to. What the page is short of the finger then
 * goes to nothing in a tenth of a second, in how far its edge has gone and
 * in how it leans alike, and from there the edge is where the finger is.
 * Only a page short of its finger the way the turn goes comes to it: one
 * already past it would run against the hand, and keeps its distance.
 */
function broughtTo(
  leaf: Leaf,
  held: Held,
  scene: TransitionScene,
  frame: TransitionFrame,
  touch: TransitionTouch,
  read: LeafTurn,
  own: number,
  seconds: number,
): { readonly edge: number; readonly lean: number } {
  const shape = leaf.shape;
  const lean = (asked: number, gone: number): number =>
    leantBy(shape, asked, gone, held.y, held.kept);
  const ownLean = lean(held.wanted, own);
  const meets = Math.max(0, shape.spine + shape.width - touch.position.x);
  const way = read.forward ? 1 : -1;
  const gone = way * (touch.origin.x - touch.position.x);
  if (!held.setOff && frame.incoming !== null && gone >= LEAST_PULL * scene.cssPixel) {
    held.setOff = true;
    if (way * (meets - own) > 0) {
      held.coming = { edge: meets - own, lean: lean(held.wanted, meets) - ownLean, seconds: 0 };
    }
  } else if (held.coming) {
    held.coming.seconds += seconds;
  }
  const coming = held.coming;
  if (!coming) return { edge: own, lean: ownLean };
  const share = stillShort(coming.seconds);
  const left = Math.abs(coming.edge) * share < WITH_IT * scene.cssPixel ? 0 : share;
  const edge = meets - coming.edge * left;
  return { edge, lean: lean(lean(held.wanted, meets) - coming.lean * left, edge) };
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
