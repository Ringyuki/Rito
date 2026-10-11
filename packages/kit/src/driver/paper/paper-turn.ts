import type {
  PaintedTransitionEffect,
  TransitionFrame,
  TransitionPage,
  TransitionScene,
} from '../effects';
import { layLeaf, leafPoint, poseAt, type LeafGrab, type LeafShape } from './leaf';
import { colourOf, drawUnder, paintPlain } from './pages';
import { createPaperPhysics, grabOf } from './paper-physics';
import { createPaperRenderer, eyeHeight, type PaperRenderer } from './renderer';

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

/** The grid the leaf is drawn with: fine enough for its bend to look smooth. */
const COLUMNS = 64;
const ROWS = 48;
/** How fast the leaf swings at most, in turns per second: what a jump of the hand becomes. */
const FASTEST = 9;
/**
 * How far over a leaf swings when a spread is one page: just past upright,
 * where it has left the frame by its left edge. The rest of the way round
 * would be out of sight.
 */
const OUT_OF_SIGHT = 0.53;
/** A frame this long after the last one, in ms, begins a turn of its own. */
const SAME_TURN_WITHIN = 250;

/** The turn the leaf is in the middle of. */
interface Turn {
  /** What the turn is told from the next by: the page on the leaf's front, and its size. */
  readonly key: unknown;
  readonly shape: LeafShape;
  readonly forward: boolean;
  readonly grab: LeafGrab;
  /** How far over the leaf is once turned: lying left of the spine, or out of sight. */
  readonly far: number;
  /** How far over the leaf is drawn: 0 lying right of the spine, 1 lying left of it. */
  shown: number;
  /** Where the leaf was, and the turn had got to, when the finger let go. */
  letGo: { readonly shown: number; readonly turned: number } | null;
}

interface PaperTurn {
  readonly now: () => number;
  readonly paper: readonly [number, number, number];
  readonly renderer: PaperRenderer;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  turn: Turn | null;
  paintedAt: number;
}

/** A frame read as a leaf's turn: which way, how far over, and the pages on its faces. */
interface LeafTurn {
  readonly forward: boolean;
  /** How far the turn has gone toward lying left of the spine, 0–1. */
  readonly turned: number;
  readonly front: TransitionPage | null;
  readonly back: TransitionPage | null;
}

/**
 * A page turned as a leaf of a book: bound at the spine, it bends round a
 * cone as it lifts, swings over the spine arched in the air, and comes
 * down on the far side edge first, the arch settling after. Paper bends
 * without stretching, and the leaf is never folded. It is drawn in three
 * dimensions, lit from over the reader's shoulder, with its shadow on the
 * pages beneath. With two pages a spread the leaf carries the next page on
 * its back; with one it swings out of sight past the left edge.
 *
 * It is drawn by the GPU; where there is none, turns fall back to the
 * built-in `cover`. Make one per reader.
 */
export function createPaperTurn(options: PaperTurnOptions = {}): PaintedTransitionEffect {
  const state: PaperTurn = {
    now: options.now ?? ((): number => performance.now()),
    paper: colourOf(options.paper),
    renderer: createPaperRenderer(),
    positions: new Float32Array(COLUMNS * ROWS * 3),
    normals: new Float32Array(COLUMNS * ROWS * 3),
    turn: null,
    paintedAt: Number.NEGATIVE_INFINITY,
  };
  return {
    paint(scene, frame): void {
      paint(state, scene, frame);
    },
    physics: createPaperPhysics(),
  };
}

function paint(state: PaperTurn, scene: TransitionScene, frame: TransitionFrame): void {
  const { width, height, spine } = scene;
  const read = leafTurn(scene, frame);
  // One page a spread has no leaf to bring back before the first page.
  if (!read) {
    scene.drawPage('curr', frame.dx);
    return;
  }
  const time = state.now();
  const turn = turnOf(state, scene, frame, read, time);
  const seconds =
    turn === state.turn ? Math.min(0.05, Math.max(0, (time - state.paintedAt) / 1000)) : 0;
  state.turn = turn;
  state.paintedAt = time;
  const wanted = wantedOf(turn, scene, frame, read.turned);
  const reach = FASTEST * seconds;
  turn.shown += Math.min(reach, Math.max(-reach, wanted - turn.shown));

  layLeaf(
    turn.shape,
    poseAt(turn.shape, turn.grab, turn.shown),
    COLUMNS,
    ROWS,
    state.positions,
    state.normals,
  );
  const image = state.renderer.draw({
    width,
    height,
    spine,
    positions: state.positions,
    normals: state.normals,
    columns: COLUMNS,
    rows: ROWS,
    front: read.front,
    back: read.back,
    paper: state.paper,
  });
  if (!image) {
    state.turn = null;
    paintPlain(scene, frame);
    return;
  }
  // The pages the leaf leaves and lands on, then the leaf and its shadow over them.
  drawUnder(scene, 0, spine, read.forward ? 'curr' : frame.incoming);
  drawUnder(scene, spine, width, read.forward ? frame.incoming : 'curr');
  scene.context.drawImage(image, 0, 0, width, height);
}

/**
 * The leaf a frame turns: forward it is the one lying right of the spine,
 * printed with this spread and, on its back, the next; turning back it is
 * the one before, coming over from the left. Null when there is no such
 * leaf to show.
 */
function leafTurn(scene: TransitionScene, frame: TransitionFrame): LeafTurn | null {
  const forward = frame.incoming ? frame.incoming === 'next' : frame.dx < 0;
  if (!forward && !frame.incoming && scene.spine === 0) return null;
  const toward = forward ? -frame.dx : frame.dx;
  const along = Math.min(1, Math.max(0, toward / (scene.width || 1)));
  const frontSlot = forward ? 'curr' : frame.incoming;
  // One page a spread shows nothing of the spread a leaf lands on.
  const backSlot = scene.spine === 0 ? null : forward ? frame.incoming : 'curr';
  return {
    forward,
    turned: forward ? along : 1 - along,
    front: frontSlot ? scene.page(frontSlot) : null,
    back: backSlot ? scene.page(backSlot) : null,
  };
}

/** The turn this frame belongs to: the one in flight, or a new one lying where it starts from. */
function turnOf(
  state: PaperTurn,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: LeafTurn,
  time: number,
): Turn {
  const shape = { spine: scene.spine, width: scene.width - scene.spine, height: scene.height };
  const key = read.front?.content ?? null;
  const turn = state.turn;
  const same =
    turn?.key === key &&
    turn.forward === read.forward &&
    turn.shape.spine === shape.spine &&
    turn.shape.width === shape.width &&
    turn.shape.height === shape.height &&
    time - state.paintedAt <= SAME_TURN_WITHIN;
  if (same) return turn;
  const far = shape.spine > 0 ? 1 : OUT_OF_SIGHT;
  return {
    key,
    shape,
    forward: read.forward,
    grab: grabOf(frame.touch, scene),
    far,
    shown: read.forward ? 0 : far,
    letGo: null,
  };
}

/**
 * How far over the leaf should be drawn. Under a finger, as far as puts the
 * held point of it under the finger. Let go, on from there in step with
 * the turn. Turned by no finger, as far as the turn has gone.
 */
function wantedOf(
  turn: Turn,
  scene: TransitionScene,
  frame: TransitionFrame,
  turned: number,
): number {
  if (!frame.touch) return turned * turn.far;
  if (frame.phase === 'held') {
    turn.letGo = null;
    // The turn's own measure of the finger: where across the spread the held point should show.
    const out = turn.grab.u * turn.shape.width;
    return swungTo(turn, scene, turn.shape.spine + out * (1 - 2 * turned));
  }
  turn.letGo ??= { shown: turn.shown, turned };
  const over = (frame.phase === 'landing') === turn.forward;
  const left = (over ? 1 : 0) - turn.letGo.turned;
  const done = Math.abs(left) < 1e-6 ? 1 : (turned - turn.letGo.turned) / left;
  const end = over ? turn.far : 0;
  return turn.letGo.shown + (end - turn.letGo.shown) * Math.min(1, Math.max(0, done));
}

/** How far over the leaf must be for its held point to show at `x` across the frame. */
function swungTo(turn: Turn, scene: TransitionScene, x: number): number {
  const eye = eyeHeight(scene.width, scene.height);
  const out = turn.grab.u * turn.shape.width;
  const down = turn.grab.v * turn.shape.height;
  const showsAt = (shown: number): number => {
    const [px, , pz] = leafPoint(turn.shape, poseAt(turn.shape, turn.grab, shown), out, down);
    return scene.width / 2 + ((px - scene.width / 2) * eye) / (eye - pz);
  };
  // The point shows farther left the farther over the leaf is.
  let low = 0;
  let high = turn.far;
  for (let pass = 0; pass < 22; pass += 1) {
    const middle = (low + high) / 2;
    if (showsAt(middle) > x) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
