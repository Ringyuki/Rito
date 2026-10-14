import type { TransitionPoint } from '../effects';
import { leafPoint, poseAt, type LeafGrab, type LeafShape } from './leaf';

/**
 * The point of a leaf a finger holds (`u` from the spine outward, `v` from
 * the top down) and how far left of the finger it shows: a finger that
 * takes a leaf in the air beside it keeps that distance.
 */
export interface Hold {
  readonly u: number;
  readonly v: number;
  readonly offset: number;
}

/** The frame a leaf is seen in: its size and how high the eye is over it. */
export interface View {
  readonly width: number;
  readonly height: number;
  readonly eye: number;
}

/** A hand takes the leaf no nearer the spine than this share of its width. */
export const NEAREST_HOLD = 0.35;

/** Where a point in the air shows across the frame, as the eye sees it. */
function seenAcross(view: View, x: number, z: number): number {
  return view.width / 2 + ((x - view.width / 2) * view.eye) / (view.eye - z);
}

function seenDown(view: View, y: number, z: number): number {
  return view.height / 2 + ((y - view.height / 2) * view.eye) / (view.eye - z);
}

/**
 * The hold a finger takes of a leaf lying as `positions` say (a grid of
 * `columns` by `rows` points): the point of it that shows nearest the
 * finger, no nearer the spine than a hand turns a leaf by.
 */
export function holdOf(
  positions: Float32Array,
  columns: number,
  rows: number,
  view: View,
  finger: TransitionPoint,
): Hold {
  const first = Math.ceil(NEAREST_HOLD * (columns - 1));
  let nearest = { column: columns - 1, row: 0, across: finger.x, away: Infinity };
  for (let row = 0; row < rows; row += 1) {
    for (let column = first; column < columns; column += 1) {
      const at = (row * columns + column) * 3;
      const z = positions[at + 2] ?? 0;
      const across = seenAcross(view, positions[at] ?? 0, z);
      const down = seenDown(view, positions[at + 1] ?? 0, z);
      const away = (across - finger.x) ** 2 + (down - finger.y) ** 2;
      if (away < nearest.away) nearest = { column, row, across, away };
    }
  }
  return {
    u: nearest.column / (columns - 1),
    v: nearest.row / (rows - 1),
    offset: finger.x - nearest.across,
  };
}

/**
 * How far over the leaf must be for the point a finger holds to show where
 * the finger has it, no farther than `farthest`. The point shows farther
 * left the farther over the leaf is, until it is out of sight.
 */
export function swungTo(
  shape: LeafShape,
  grab: LeafGrab,
  hold: Hold,
  view: View,
  fingerX: number,
  farthest: number,
): number {
  const out = hold.u * shape.width;
  const down = hold.v * shape.height;
  const wanted = fingerX - hold.offset;
  const showsAt = (shown: number): number => {
    const [x, , z] = leafPoint(shape, poseAt(shape, grab, shown), out, down);
    return seenAcross(view, x, z);
  };
  let low = 0;
  let high = farthest;
  for (let pass = 0; pass < 22; pass += 1) {
    const middle = (low + high) / 2;
    if (showsAt(middle) > wanted) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
