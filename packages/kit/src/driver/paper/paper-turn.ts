import {
  transitionEffects,
  type PaintedTransitionEffect,
  type TransitionFrame,
  type TransitionPage,
  type TransitionScene,
} from '../effects';
import type { SlotPosition } from '../../painter/types';
import { createPaperPhysics, grabOf, type PaperGrab } from './paper-physics';
import { createPaperRenderer, eyeHeight, type PaperRenderer } from './renderer';
import { createSheet, type Sheet, type SheetHold } from './sheet';

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

/** How far short of the sheet's full reach the hand carries it: what lets the paper bow. */
const SLACK = 0.12;
/** The hand lets go once the turn is this close to its end, and the sheet falls the rest. */
const LET_GO_WITHIN = 0.2;
/** From this close to its end the sheet is pressed flat onto the page it lands on. */
const FLATTEN_WITHIN = 0.1;
/** How fast a hand carries the sheet at most, in turns per second. */
const HAND_SPEED = 7;
/** A frame this long after the last one, in ms, begins a turn of its own. */
const SAME_TURN_WITHIN = 250;

/** The turn the sheet is in the middle of. */
interface Turn {
  /** What the turn is told from the next by: the page on the sheet's front, and its size. */
  readonly key: unknown;
  readonly shape: string;
  readonly forward: boolean;
  readonly grab: PaperGrab;
  /** Where the hand is along the turn, 0–1. */
  hand: number;
  /** How far the hand is from the height it took hold at. */
  lift: number;
  /** How far the turn was from its end when the finger let go. */
  span: number | null;
}

interface PaperTurn {
  readonly now: () => number;
  readonly paper: readonly [number, number, number];
  readonly sheet: Sheet;
  readonly renderer: PaperRenderer;
  turn: Turn | null;
  paintedAt: number;
  /** Whether the last frame was drawn by the GPU. */
  drawn: boolean;
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
 * A page turned as a sheet of paper: it bows behind the hand that carries
 * it, twists when taken by a corner, falls onto the page it lands on, and
 * is lit and casts a shadow as it goes. With two pages a spread it turns
 * over the spine like a leaf of a book and shows the next page on its back.
 *
 * The sheet is simulated every frame and drawn by the GPU; where there is
 * none, turns fall back to the built-in `cover`. Make one per reader.
 */
export function createPaperTurn(options: PaperTurnOptions = {}): PaintedTransitionEffect {
  const state: PaperTurn = {
    now: options.now ?? ((): number => performance.now()),
    paper: colourOf(options.paper),
    sheet: createSheet(),
    renderer: createPaperRenderer(),
    turn: null,
    paintedAt: Number.NEGATIVE_INFINITY,
    drawn: false,
  };
  return {
    paint(scene, frame): void {
      paint(state, scene, frame);
    },
    physics: createPaperPhysics({
      // The sheet is worth waiting for only while it is being drawn.
      settling: () =>
        state.drawn && state.now() - state.paintedAt < SAME_TURN_WITHIN ? state.sheet : null,
      forward: () => state.turn?.forward ?? null,
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
  const fresh = turn !== state.turn;
  const seconds = fresh ? 1 / 60 : Math.min(0.05, Math.max(0, (time - state.paintedAt) / 1000));
  state.turn = turn;
  state.paintedAt = time;
  carry(state.sheet, turn, scene, frame, read.turned, seconds);

  const image = state.renderer.draw({
    width,
    height,
    spine,
    positions: state.sheet.positions,
    columns: state.sheet.columns,
    rows: state.sheet.rows,
    front: read.front,
    back: read.back,
    paper: state.paper,
  });
  state.drawn = image !== null;
  if (!image) {
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

/** The turn this frame belongs to: the one in flight, or a new one with the sheet laid out for it. */
function turnOf(
  state: PaperTurn,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: SheetTurn,
  time: number,
): Turn {
  const { width, height, spine } = scene;
  const key = read.front?.content ?? null;
  const shape = `${String(width)}x${String(height)}@${String(spine)}`;
  const turn = state.turn;
  const same =
    turn?.key === key &&
    turn.forward === read.forward &&
    turn.shape === shape &&
    time - state.paintedAt <= SAME_TURN_WITHIN;
  if (same) return turn;
  state.sheet.reset({ spine, width: width - spine, height }, read.turned);
  return {
    key,
    shape,
    forward: read.forward,
    grab: grabOf(frame.touch, scene),
    hand: read.turned,
    lift: 0,
    span: null,
  };
}

/** Moves the sheet on by `seconds`: carried by the hand, then let fall and pressed flat. */
function carry(
  sheet: Sheet,
  turn: Turn,
  scene: TransitionScene,
  frame: TransitionFrame,
  turned: number,
  seconds: number,
): void {
  // The pose the turn is heading for, once nothing holds it.
  const pose = frame.phase === 'held' ? null : (frame.phase === 'landing') === turn.forward ? 1 : 0;
  const remaining = pose === null ? 1 : Math.abs(turned - pose);
  const reach = HAND_SPEED * seconds;
  turn.hand += Math.min(reach, Math.max(-reach, turned - turn.hand));
  if (pose !== null) turn.span ??= Math.max(remaining, 1e-3);

  const grip = pose === null ? 1 : smoothstep(LET_GO_WITHIN * 0.45, LET_GO_WITHIN, remaining);
  const hold = grip > 0 ? holdOf(turn, scene, frame, remaining, grip) : null;
  const press = 1 - remaining / FLATTEN_WITHIN;
  sheet.step(
    seconds,
    hold,
    pose !== null && press > 0 ? { pose, weight: 0.02 + 0.3 * press } : null,
  );
}

/** Where the hand has the point it holds: under the finger, as high as the paper reaches. */
function holdOf(
  turn: Turn,
  scene: TransitionScene,
  frame: TransitionFrame,
  remaining: number,
  grip: number,
): SheetHold {
  const { width, height, spine } = scene;
  const radius = turn.grab.u * (width - spine);
  const rest = turn.grab.v * height;
  if (frame.phase === 'held' && frame.touch) {
    turn.lift = Math.min(0.4 * radius, Math.max(-0.4 * radius, frame.touch.position.y - rest));
  }
  // A hand with no finger behind it rises through the turn; a finger's height eases back.
  const lift = frame.touch
    ? turn.lift * smoothstep(0, 1, turn.span === null ? 1 : remaining / turn.span)
    : -0.06 * height * Math.sin(Math.PI * turn.hand);
  const onScreen = { x: spine + radius * (1 - 2 * turn.hand), y: rest + lift };
  const chord = radius * (1 - SLACK * Math.sin(Math.PI * turn.hand));
  const eye = eyeHeight(width, height);
  let x = onScreen.x;
  let y = onScreen.y;
  let z = 0;
  // What rises toward the eye looks larger: settle on the point that shows under the finger.
  for (let pass = 0; pass < 3; pass += 1) {
    const scale = (eye - z) / eye;
    x = width / 2 + (onScreen.x - width / 2) * scale;
    y = height / 2 + (onScreen.y - height / 2) * scale;
    const across = Math.sqrt(Math.max(0, chord * chord - (y - rest) * (y - rest)));
    const out = Math.min(across, Math.max(-across, x - spine));
    x = spine + out;
    z = Math.sqrt(Math.max(0, across * across - out * out));
  }
  // A finger pinches the paper; a hand with no finger behind it sweeps the edge.
  return { u: turn.grab.u, v: turn.grab.v, x, y, z, grip, span: frame.touch ? 0.05 : 0.42 };
}

/** One of the pages beneath the sheet, between two x. */
function drawUnder(
  scene: TransitionScene,
  left: number,
  right: number,
  slot: SlotPosition | null,
): void {
  if (!slot || right <= left) return;
  const { context } = scene;
  context.save();
  context.beginPath();
  context.rect(left, 0, right - left, scene.height);
  context.clip();
  scene.drawPage(slot, 0);
  context.restore();
}

/** The turn without a GPU: the built-in cover's pages. */
function paintPlain(scene: TransitionScene, frame: TransitionFrame): void {
  for (const layer of transitionEffects.cover.layers(frame)) {
    scene.drawPage(layer.slot, Math.round(layer.x), layer.opacity);
  }
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function colourOf(hex: string | undefined): [number, number, number] {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex ?? '')?.[1];
  if (!digits) return [1, 1, 1];
  const channel = (at: number): number => Number.parseInt(digits.slice(at, at + 2), 16) / 255;
  return [channel(0), channel(2), channel(4)];
}
