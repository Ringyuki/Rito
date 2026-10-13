import type {
  PaintedTransitionEffect,
  TransitionFrame,
  TransitionPage,
  TransitionScene,
} from '../effects';
import { bring, layOut } from './aloft';
import { stillHeld } from './curl-held';
import { byItself, curledFlat, isThere, wantedCurled } from './curled';
import type { LeafShape } from './leaf';
import { leaveAlone, placeInBook, type Leaf } from './leaves';
import { gridFor } from './mesh';
import { colourOf, paintPlain } from './pages';
import { createPaperPhysics, grabOf } from './paper-physics';
import { createPaperRenderer, type PaperRenderer, type PaperSheet } from './renderer';
import { createSheets } from './sheets';
import { aloneBy, leafTurn, wantedOf, type LeafTurn } from './swing';

export interface PaperTurnOptions {
  /**
   * The paper's colour, as `#rrggbb`: what shows where a page's bitmap is
   * transparent. White when omitted. A page painted with its own
   * background needs none.
   */
  readonly paper?: string;
  /** The clock the leaf moves by, in ms. The page's own when omitted. */
  readonly now?: () => number;
}

/** A frame this long after the last one, in ms, begins anew: nothing is in the air. */
const SAME_TURN_WITHIN = 250;

interface PaperTurn {
  readonly now: () => number;
  readonly paper: readonly [number, number, number];
  readonly renderer: PaperRenderer;
  /** The leaves in the air, in the order they come in the book. */
  book: Leaf[];
  /** The leaf the turn on screen is of. */
  led: Leaf | null;
  paintedAt: number;
  /** How many frames have been painted. */
  painted: number;
  /** The GPU context the leaves' pages were taken in. */
  epoch: number;
  /** The leaf whose turn began before the GPU was ready, and is drawn plain to its end; else null. */
  plain: number | null;
  /** That a turn was drawn plain for that reason has been said. */
  said: boolean;
  /** The sheets of a frame: the leaves, and the pages lying flat under them. */
  readonly sheets: (
    book: readonly Leaf[],
    shape: LeafShape,
    columns: number,
    rows: number,
  ) => PaperSheet[];
}

/**
 * A page turned as paper is. With two pages a spread it is a leaf of a
 * book: bound at the spine, it bends round a cone as it lifts, swings over
 * the spine arched in the air, carrying the next page on its back, and
 * comes down on the far side edge first, the arch settling after. With one
 * page a spread it is curled over on itself: peeled back from its outer
 * edge or a corner round a small roll, its back showing, until the line it
 * leaves the page at reaches the spine. Paper bends without stretching.
 * Either way it is drawn in three dimensions, lit from over the reader's
 * shoulder, with its shadow on the pages beneath.
 *
 * A turn that cuts into another does not stop its page. Turned back, the
 * same page comes back from where it is; turned on, it carries on by itself
 * while the next lifts, so several are in the air at once; and a finger
 * takes a page in the air where it is.
 *
 * It is drawn by the GPU; where there is none, turns fall back to the
 * built-in `cover`. Make one per reader.
 */
export function createPaperTurn(options: PaperTurnOptions = {}): PaintedTransitionEffect {
  return paperTurnWith(createPaperRenderer(), options);
}

/** The paper turn drawn by `renderer`: what `createPaperTurn` makes, with a renderer of its own. */
export function paperTurnWith(
  renderer: PaperRenderer,
  options: PaperTurnOptions = {},
): PaintedTransitionEffect {
  const state: PaperTurn = {
    now: options.now ?? ((): number => performance.now()),
    paper: colourOf(options.paper),
    renderer,
    book: [],
    led: null,
    paintedAt: Number.NEGATIVE_INFINITY,
    painted: 0,
    epoch: 0,
    plain: null,
    said: false,
    sheets: createSheets(),
  };
  // A leaf left to come down counts for as long as frames are drawn to bring it down.
  const aloft = (): boolean =>
    state.now() - state.paintedAt <= SAME_TURN_WITHIN &&
    state.book.some((leaf) => leaf.flight !== null);
  return {
    paint(scene, frame): void {
      paint(state, scene, frame);
    },
    // The shaders are compiled while the book is opened, not in the first frame of the first turn.
    prepare(): void {
      state.renderer.prepare();
    },
    physics: createPaperPhysics(aloft, {
      painted: () => state.painted,
      // A page curled over is where its turn takes it before the turn has slowed to a stop.
      there: () => state.led !== null && isThere(state.led),
      gone: () => state.led !== null && isThere(state.led) && state.led.shown >= 1,
    }),
  };
}

function paint(state: PaperTurn, scene: TransitionScene, frame: TransitionFrame): void {
  state.painted += 1;
  const read = leafTurn(scene, frame);
  // One page a spread has no leaf to bring back before the first page.
  if (!read) {
    forget(state);
    scene.drawPage('curr', frame.dx);
    return;
  }
  const time = state.now();
  const shape = { spine: scene.spine, width: scene.width - scene.spine, height: scene.height };
  if (stale(state, shape, time, frame)) {
    forget(state);
    state.plain = null;
  }
  const seconds = Math.min(0.05, Math.max(0, (time - state.paintedAt) / 1000));
  state.paintedAt = time;
  if (drawnPlain(state, read.spread)) {
    paintPlain(scene, frame);
    return;
  }
  state.epoch = state.renderer.epoch;

  const grid = gridFor(scene.spine);
  const known = state.book.length;
  const led = leafOf(state, scene, frame, read, shape);
  const wanted = led.curled
    ? wantedCurled(led, led.curled, scene, frame, read, seconds)
    : wantedOf(led, scene, frame, read);
  const first = state.book.length > known;
  const out = bring(state.book, led, wanted, frame.phase === 'held', first, seconds);
  for (const leaf of out) letGoOf(state, leaf);
  layOut(state.book, grid.columns, grid.rows);
  hold(state, led, read);

  const image = state.renderer.draw({
    width: scene.width,
    height: scene.height,
    spine: scene.spine,
    ...grid,
    sheets: state.sheets(state.book, shape, grid.columns, grid.rows),
    paper: state.paper,
  });
  if (!image) {
    forget(state);
    paintPlain(scene, frame);
    return;
  }
  scene.context.drawImage(image, 0, 0, scene.width, scene.height);
}

/**
 * Whether this frame is drawn as the built-in cover: there is no GPU, or the
 * turn began while the GPU was still compiling. Such a turn stays plain to
 * its end, for a leaf appearing halfway would be a jump, and nothing waits:
 * a turn is never held up for its looks.
 */
function drawnPlain(state: PaperTurn, leaf: number): boolean {
  if (state.plain === leaf) return true;
  const standing = state.renderer.standing;
  state.plain = standing === 'ready' ? null : leaf;
  if (standing === 'ready') return false;
  if (standing === 'waiting' && !state.said) {
    state.said = true;
    console.warn('[rito] the paper turn was not ready for this turn, which is drawn plain');
  }
  return true;
}

/**
 * Whether what is remembered of the leaves is of another moment: long ago,
 * another size, another GPU. A page a finger still holds is of this one
 * however long its last frame took.
 */
function stale(state: PaperTurn, shape: LeafShape, time: number, frame: TransitionFrame): boolean {
  const sized = (leaf: Leaf): boolean =>
    leaf.shape.spine === shape.spine &&
    leaf.shape.width === shape.width &&
    leaf.shape.height === shape.height;
  const held = stillHeld(state.led?.curled ?? null, frame);
  return (
    (time - state.paintedAt > SAME_TURN_WITHIN && !held) ||
    // Leaves hold pages of the GPU context they were taken in; with none held it is all one.
    (state.book.length > 0 && state.epoch !== state.renderer.epoch) ||
    !state.book.every(sized)
  );
}

/** Nothing is in the air any more: the pages the leaves held are let go. */
function forget(state: PaperTurn): void {
  // Pages taken from a GPU context since lost went with it.
  if (state.epoch === state.renderer.epoch) for (const leaf of state.book) letGoOf(state, leaf);
  state.book = [];
  state.led = null;
}

function letGoOf(state: PaperTurn, leaf: Leaf): void {
  if (leaf.front) state.renderer.release(leaf.front);
  if (leaf.after) state.renderer.release(leaf.after);
  leaf.front = null;
  leaf.after = null;
}

/**
 * The leaf this frame is of: one already in the air, taken up where it is,
 * or a new one lying where its turn starts from. Every other leaf in the
 * air is left to come down by itself.
 */
function leafOf(
  state: PaperTurn,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: LeafTurn,
  shape: LeafShape,
): Leaf {
  const printed = read.front?.content ?? null;
  let led = state.book.find((leaf) => leaf.spread === read.spread);
  // The same place in another book: what is remembered of it is of something else.
  if (led && led.printed !== printed) {
    letGoOf(state, led);
    state.book.splice(state.book.indexOf(led), 1);
    led = undefined;
  }
  const taken = led ?? newLeaf(scene, frame, read, shape);
  if (!led) placeInBook(state.book, taken);
  if (state.led !== taken) {
    taken.flight = null;
    // It goes on from where it is, whatever it was doing by itself.
    if (taken.curled) taken.curled.pace = null;
    leaveAlone(state.book, taken, taken.curled ? byItself(scene) : aloneBy(scene.width));
  }
  state.led = taken;
  return taken;
}

/** A leaf lying where its turn starts from: a page to curl over with one page a spread. */
function newLeaf(
  scene: TransitionScene,
  frame: TransitionFrame,
  read: LeafTurn,
  shape: LeafShape,
): Leaf {
  const grid = gridFor(shape.spine);
  return {
    spread: read.spread,
    printed: read.front?.content ?? null,
    shape,
    curled: shape.spine === 0 ? curledFlat() : null,
    grab: grabOf(frame.touch, scene),
    hold: null,
    heldFrom: null,
    shown: read.forward ? 0 : 1,
    speed: 0,
    letGo: null,
    front: null,
    after: null,
    flight: null,
    positions: new Float32Array(grid.columns * grid.rows * 3),
    normals: new Float32Array(grid.columns * grid.rows * 3),
  };
}
/** The led leaf shows its pages as they are now; a leaf left alone keeps them as they were. */
function hold(state: PaperTurn, led: Leaf, read: LeafTurn): void {
  const taken = (page: TransitionPage | null, was: Leaf['front']): Leaf['front'] => {
    const now = page ? state.renderer.snapshot(page) : null;
    if (was) state.renderer.release(was);
    return now;
  };
  led.front = taken(read.front, led.front);
  led.after = taken(read.after, led.after);
}
