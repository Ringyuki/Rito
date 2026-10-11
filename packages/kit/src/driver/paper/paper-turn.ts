import type {
  PaintedTransitionEffect,
  TransitionFrame,
  TransitionPage,
  TransitionScene,
} from '../effects';
import { foldBetween, layOut, withinReach, type CurlPoint, type SheetShape } from './curl';
import { colourOf, drawUnder, paintPlain } from './pages';
import { createPaperPhysics, grabOf } from './paper-physics';
import { createPaperRenderer, type PaperRenderer } from './renderer';

export interface PaperTurnOptions {
  /**
   * The paper's colour, as `#rrggbb`: what shows where a page's bitmap is
   * transparent. White when omitted. A page painted with its own
   * background needs none.
   */
  readonly paper?: string;
  /** The clock the sheet moves by, in ms. The page's own when omitted. */
  readonly now?: () => number;
}

/** The grid the sheet is drawn with: fine enough for the roll to look round. */
const COLUMNS = 72;
const ROWS = 54;
/** The radius the paper rolls over at, as a share of the sheet's width. */
const ROLL = 0.1;
/** How far a corner taken by no finger rises on its way over, in sheet widths. */
const RISE = 0.42;
/** How quickly the held point reaches where it is wanted, per second. */
const FOLLOW = 70;
/** A frame this long after the last one, in ms, begins a turn of its own. */
const SAME_TURN_WITHIN = 250;

/** The turn the sheet is in the middle of. */
interface Turn {
  /** What the turn is told from the next by: the page on the sheet's front, and its size. */
  readonly key: unknown;
  readonly shape: SheetShape;
  readonly forward: boolean;
  /** The point of the flat sheet that is held. */
  readonly held: CurlPoint;
  /** Where that point is now, and how fast it is moving. */
  at: CurlPoint;
  speed: CurlPoint;
  /** Where it is wanted. */
  wanted: CurlPoint;
  /** How far the finger was from the height it took hold at when it let go. */
  lift: number;
  /** How far the turn was from its end at that moment. */
  span: number | null;
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

/** A frame read as a sheet's turn: which way, how far over, and the pages on its faces. */
interface SheetTurn {
  readonly forward: boolean;
  /** How far the sheet is over: 0 lying right of the spine, 1 lying left of it. */
  readonly turned: number;
  readonly front: TransitionPage | null;
  readonly back: TransitionPage | null;
}

/**
 * A page turned as a sheet of paper. The paper is held at a point — under
 * the finger, or by a corner when no finger turns it — and rolls back over
 * itself between where that point was and where it is: flat on either side
 * of a round fold, the way paper bends. It is drawn in three dimensions,
 * lit along the roll, with the shadow of the lifted paper on what lies
 * beneath. With two pages a spread the sheet turns over the spine like a
 * leaf of a book and carries the next page on its back.
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
    physics: createPaperPhysics({
      // The paper is worth waiting for only while it is being drawn.
      arrived: () =>
        !state.turn || state.now() - state.paintedAt > SAME_TURN_WITHIN || hasArrived(state.turn),
    }),
  };
}

function paint(state: PaperTurn, scene: TransitionScene, frame: TransitionFrame): void {
  const { width, height, spine } = scene;
  const read = sheetTurn(scene, frame);
  // One page a spread has no sheet to bring back before the first page.
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
  follow(turn, frame, read.turned, seconds);

  const radius = rollOf(turn);
  const fold = foldBetween(turn.held, turn.at, radius, turn.shape);
  layOut(turn.shape, fold, COLUMNS, ROWS, state.positions, state.normals);
  const image = state.renderer.draw({
    width,
    height,
    spine,
    positions: state.positions,
    normals: state.normals,
    columns: COLUMNS,
    rows: ROWS,
    lift: 2 * radius,
    relief: radius / (ROLL * turn.shape.width),
    front: read.front,
    back: read.back,
    paper: state.paper,
  });
  if (!image) {
    // No GPU: nothing of the paper is on screen to wait for.
    state.turn = null;
    paintPlain(scene, frame);
    return;
  }
  // The pages the sheet leaves and lands on, then the sheet and its shadow over them.
  drawUnder(scene, 0, spine, read.forward ? 'curr' : frame.incoming);
  drawUnder(scene, spine, width, read.forward ? frame.incoming : 'curr');
  scene.context.drawImage(image, 0, 0, width, height);
}

/**
 * The sheet a frame turns: forward it is the one lying right of the spine,
 * printed with this spread and, on its back, the next; turning back it is
 * the one before, coming over from the left. Null when there is no such
 * sheet to show.
 */
function sheetTurn(scene: TransitionScene, frame: TransitionFrame): SheetTurn | null {
  const forward = frame.incoming ? frame.incoming === 'next' : frame.dx < 0;
  if (!forward && !frame.incoming && scene.spine === 0) return null;
  const toward = forward ? -frame.dx : frame.dx;
  const along = Math.min(1, Math.max(0, toward / (scene.width || 1)));
  const frontSlot = forward ? 'curr' : frame.incoming;
  // One page a spread shows nothing of the spread a sheet lands on.
  const backSlot = scene.spine === 0 ? null : forward ? frame.incoming : 'curr';
  return {
    forward,
    turned: forward ? along : 1 - along,
    front: frontSlot ? scene.page(frontSlot) : null,
    back: backSlot ? scene.page(backSlot) : null,
  };
}

/** The turn this frame belongs to: the one in flight, or a new one held where the frame says. */
function turnOf(
  state: PaperTurn,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: SheetTurn,
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
  const grab = grabOf(frame.touch, scene);
  const held = { x: shape.spine + grab.u * shape.width, y: grab.v * shape.height };
  // The sheet starts where it lies: flat, or turned over, its held point across the spine.
  const at = read.forward ? held : mirrored(held, shape);
  return {
    key,
    shape,
    forward: read.forward,
    held,
    at,
    speed: { x: 0, y: 0 },
    wanted: at,
    lift: 0,
    span: null,
  };
}

/** Where a point of the flat sheet lies once the sheet is turned over. */
function mirrored(point: CurlPoint, shape: SheetShape): CurlPoint {
  return { x: 2 * shape.spine - point.x, y: point.y };
}

/**
 * Moves the held point toward where the turn wants it: across the spread as
 * far as the turn has gone, at the finger's height while one holds it, and
 * without overshooting, like a hand.
 */
function follow(turn: Turn, frame: TransitionFrame, turned: number, seconds: number): void {
  const { held, shape } = turn;
  const over = mirrored(held, shape);
  const pose = frame.phase === 'held' ? null : (frame.phase === 'landing') === turn.forward ? 1 : 0;
  const remaining = pose === null ? 1 : Math.abs(turned - pose);
  if (pose !== null) turn.span ??= Math.max(remaining, 1e-3);
  if (frame.phase === 'held' && frame.touch) turn.lift = frame.touch.position.y - held.y;
  // A finger's height eases back as the turn finishes; a corner no finger holds rises and falls.
  const lift = frame.touch
    ? turn.lift * smoothstep(0, 1, turn.span === null ? 1 : remaining / turn.span)
    : (held.y < shape.height / 2 ? 1 : -1) * RISE * shape.width * Math.sin(Math.PI * turned);
  turn.wanted = withinReach(
    held,
    { x: held.x + (over.x - held.x) * turned, y: held.y + lift },
    shape,
  );
  // A critically damped spring from where the point is to where it is wanted.
  const decay = Math.exp(-FOLLOW * seconds);
  for (const axis of ['x', 'y'] as const) {
    const off = turn.at[axis] - turn.wanted[axis];
    const carried = (turn.speed[axis] + FOLLOW * off) * seconds;
    turn.at = { ...turn.at, [axis]: turn.wanted[axis] + (off + carried) * decay };
    turn.speed = {
      ...turn.speed,
      [axis]: (turn.speed[axis] - FOLLOW * carried) * decay,
    };
  }
  // What is left is less than the eye can see: the point is there.
  const off = Math.hypot(turn.at.x - turn.wanted.x, turn.at.y - turn.wanted.y);
  if (off < 0.05 && Math.hypot(turn.speed.x, turn.speed.y) < 3) {
    turn.at = turn.wanted;
    turn.speed = { x: 0, y: 0 };
  }
}

/** Whether the held point is exactly where the turn wants it: the frame drawn is the last. */
function hasArrived(turn: Turn): boolean {
  return turn.at.x === turn.wanted.x && turn.at.y === turn.wanted.y;
}

/**
 * The radius the paper rolls over at: nothing where the held point has not
 * left its place or has reached the far side, so that the sheet lies flat
 * at both ends of a turn, and full in between.
 */
function rollOf(turn: Turn): number {
  const full = ROLL * turn.shape.width;
  const over = mirrored(turn.held, turn.shape);
  const moved = Math.hypot(turn.at.x - turn.held.x, turn.at.y - turn.held.y);
  const left = Math.hypot(turn.at.x - over.x, turn.at.y - over.y);
  return full * smoothstep(0, 4 * full, moved) * smoothstep(0, 4 * full, left);
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
