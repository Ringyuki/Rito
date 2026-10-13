import type { TransitionFrame, TransitionScene } from '../../src/driver/effects';
import { curlThrough, layCurl, lineAt, type CurlLine } from '../../src/driver/paper/curl';
import { curledFlat, type Curled } from '../../src/driver/paper/curled';
import type { LeafShape } from '../../src/driver/paper/leaf';
import type { Leaf } from '../../src/driver/paper/leaves';
import type { LeafTurn } from '../../src/driver/paper/swing';

/** The one page of a spread the curl is tried on, and the grid it is laid out by. */
export const page: LeafShape = { spine: 0, width: 400, height: 600 };
export const COLUMNS = 201;
export const ROWS = 151;
export const scene = { width: 400, height: 600, spine: 0, cssPixel: 1 } as TransitionScene;

/** The page laid out `shown` of the way over, leaning by `lean`, or through `line`. */
export function laid(shown: number, lean: number, line?: CurlLine): Float32Array {
  const positions = new Float32Array(COLUMNS * ROWS * 3);
  const normals = new Float32Array(COLUMNS * ROWS * 3);
  const curl = curlThrough(page, line ?? lineAt(page, shown, lean));
  layCurl(page, curl, COLUMNS, ROWS, positions, normals);
  return positions;
}

export const at = (
  positions: Float32Array,
  column: number,
  row: number,
): [number, number, number] => {
  const p = (row * COLUMNS + column) * 3;
  return [positions[p] ?? 0, positions[p + 1] ?? 0, positions[p + 2] ?? 0];
};

/** A curled page `shown` of the way over, as the effect keeps it. */
export function sheet(shown: number, curled: Curled = curledFlat(), spread = 5): Leaf {
  return {
    spread,
    printed: null,
    shape: page,
    curled,
    grab: { u: 1, v: 0.5 },
    hold: null,
    heldFrom: null,
    shown,
    speed: 0,
    letGo: null,
    front: null,
    after: null,
    flight: null,
    positions: new Float32Array(COLUMNS * ROWS * 3),
    normals: new Float32Array(COLUMNS * ROWS * 3),
  };
}

/** The page's turn `turned` of its way, turning on. */
export const forward = (turned: number): LeafTurn => ({
  spread: 5,
  forward: true,
  turned,
  front: null,
  after: null,
});

/** A frame of a turn with a page to turn to; `finger` is where it came down (at x 380) and where it is. */
export const frame = (
  phase: TransitionFrame['phase'],
  finger?: [number, number, number],
): TransitionFrame => ({
  dx: 0,
  width: 400,
  incoming: 'next',
  phase,
  velocity: 0,
  touch: finger
    ? { origin: { x: 380, y: finger[0] }, position: { x: finger[1], y: finger[2] } }
    : null,
});

/** Where a point in the air shows, as the eye over the middle of the frame sees it. */
const EYE = 2.4 * 600;
export const seen = ([x, y, z]: readonly number[]): [number, number] => [
  200 + (((x ?? 0) - 200) * EYE) / (EYE - (z ?? 0)),
  300 + (((y ?? 0) - 300) * EYE) / (EYE - (z ?? 0)),
];

/** How far the page's free edge shows from where it lies flat, at the height `y`: read off the page as it is laid out. */
export function edgeGoneAt(leaf: Leaf, y: number): number {
  const positions = laid(leaf.shown, leaf.curled?.lean ?? 0);
  let before = seen(at(positions, COLUMNS - 1, 0));
  for (let row = 1; row < ROWS; row += 1) {
    const here = seen(at(positions, COLUMNS - 1, row));
    if (here[1] >= y) {
      const share = (y - before[1]) / (here[1] - before[1] || 1);
      return 400 - (before[0] + (here[0] - before[0]) * Math.min(1, Math.max(0, share)));
    }
    before = here;
  }
  return 400 - before[0];
}

/** Where the page's line crosses the height `y`, as it is drawn. */
export function lineAtHeight(leaf: Leaf, y: number): number {
  const line = lineAt(page, leaf.shown, leaf.curled?.lean ?? 0);
  return line.top + ((line.bottom - line.top) * y) / 600;
}
