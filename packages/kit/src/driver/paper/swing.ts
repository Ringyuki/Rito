import type { TransitionFrame, TransitionPage, TransitionScene } from '../effects';
import type { TransitionSettle } from '../physics';
import { holdOf, swungTo, type View } from './hold';
import { inTheAir, OUT_OF_SIGHT, sendOff, swungAt, throughAt, type Leaf } from './leaves';
import { COLUMNS, ROWS } from './mesh';
import { grabOf, leafMotion } from './paper-physics';
import { eyeHeight } from './renderer';

/** A turn this near its end, in turns of the leaf, has nowhere left to take its leaf. */
const NO_WAY_LEFT = 0.02;

/** A frame read as a leaf's turn: which leaf, which way, how far over, and the pages about it. */
export interface LeafTurn {
  /** The spread printed on the leaf's front. */
  readonly spread: number;
  readonly forward: boolean;
  /** How far the turn has gone toward lying left of the spine, 0–1. */
  readonly turned: number;
  /** The spread the leaf is lifted from, printed on its front; null for bare paper. */
  readonly front: TransitionPage | null;
  /** The spread after it: what lies under the leaf. */
  readonly after: TransitionPage | null;
}

/** How a leaf nothing leads comes down, in turns of the leaf: as a turn let go does, in a frame this wide. */
export function aloneBy(
  width: number,
): (from: number, speed: number, to: number) => TransitionSettle {
  return (from, speed, to) => {
    const motion = leafMotion(-from * width, -speed * width, -to * width);
    return (seconds) => {
      const at = motion(seconds);
      return { x: -at.x / width, velocity: -at.velocity / width, done: at.done };
    };
  };
}

/**
 * How far over the leaf should be drawn. Under a finger, as far as puts the
 * point it holds where the finger has it. Let go, on from there in step
 * with the turn. Turned by no finger, as far as the turn has gone.
 */
export function wantedOf(
  leaf: Leaf,
  scene: TransitionScene,
  frame: TransitionFrame,
  read: LeafTurn,
): number {
  const touch = frame.touch;
  if (!touch) {
    leaf.hold = null;
    leaf.heldFrom = null;
    leaf.flight = null;
    return swungAt(leaf, read.turned);
  }
  if (frame.phase === 'held') {
    leaf.letGo = null;
    leaf.flight = null;
    const view = {
      width: scene.width,
      height: scene.height,
      eye: eyeHeight(scene.width, scene.height),
    };
    const held = heldBy(leaf, scene, frame, view);
    return swungTo(
      leaf.shape,
      leaf.grab,
      held,
      view,
      touch.position.x,
      leaf.leaves ? OUT_OF_SIGHT : 1,
    );
  }
  const end = (frame.phase === 'landing') === read.forward ? 1 : 0;
  if (!leaf.letGo) {
    // A finger that took the leaf in the air may let it go with its turn already at its end
    // and the leaf not: nothing is left to carry it there, and it goes by itself.
    const stranded =
      Math.abs(end - read.turned) < NO_WAY_LEFT && Math.abs(end - leaf.shown) > NO_WAY_LEFT;
    if (stranded) sendOff(leaf, end, aloneBy(scene.width));
    leaf.letGo = { through: throughAt(leaf, leaf.shown), turned: read.turned };
  }
  const left = end - leaf.letGo.turned;
  const done = Math.abs(left) < 1e-6 ? 1 : (read.turned - leaf.letGo.turned) / left;
  const through = leaf.letGo.through + (end - leaf.letGo.through) * Math.min(1, Math.max(0, done));
  return swungAt(leaf, through);
}

/**
 * The hold the finger has of the leaf. A leaf lying flat is taken by the
 * point the finger came down on, which also shapes its bend; a leaf in the
 * air is taken by the point of it showing nearest the finger, as it is.
 */
function heldBy(
  leaf: Leaf,
  scene: TransitionScene,
  frame: TransitionFrame,
  view: View,
): NonNullable<Leaf['hold']> {
  const touch = frame.touch;
  const from = leaf.heldFrom;
  if (!touch) return leaf.hold ?? { u: leaf.grab.u, v: leaf.grab.v, offset: 0 };
  if (leaf.hold && from?.x === touch.origin.x && from.y === touch.origin.y) return leaf.hold;
  leaf.heldFrom = touch.origin;
  // A leaf that has left the frame is out of sight: it comes in to meet the finger as one lying left does.
  const gone = leaf.leaves && leaf.shown >= OUT_OF_SIGHT;
  if (inTheAir(leaf) && !gone) {
    leaf.hold = holdOf(leaf.positions, COLUMNS, ROWS, view, touch.position);
    return leaf.hold;
  }
  leaf.grab = grabOf(touch, scene);
  const out = leaf.grab.u * leaf.shape.width;
  // Lying left with one page a spread it is out of sight, and comes in to meet the finger.
  const lies = leaf.shown < 0.5 ? leaf.shape.spine + out : leaf.shape.spine - out;
  const offset = leaf.leaves && leaf.shown >= 0.5 ? 0 : touch.origin.x - lies;
  leaf.hold = { u: leaf.grab.u, v: leaf.grab.v, offset };
  return leaf.hold;
}
