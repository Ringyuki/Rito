import { buildLinks, satisfyLinks, type SheetLinks } from './sheet-links';

/**
 * A sheet of paper as a grid of particles. It is bound along one edge (the
 * spine), does not stretch, resists bending, falls under gravity onto the
 * pages beneath it and lags in the air. Something may hold one point of it.
 *
 * Lengths are in the units a frame is drawn in: x across the spread, y down
 * it, z rising toward the reader. The sheet lies to the right of the spine
 * when flat (`pose` 0) and to its left once turned (`pose` 1).
 *
 * The solver is position-based: each substep moves every particle by its
 * own momentum, then corrects positions toward what the constraints allow.
 * The substeps are short and each corrects once, which holds the paper
 * stiffer for the same work than fewer, longer steps corrected many times.
 * It stays stable however hard the sheet is pulled.
 */

/** Where the sheet is bound and how large it is. */
export interface SheetShape {
  readonly spine: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A hold on the sheet: which point of it (`u` from the spine outward, `v`
 * from the top down, both 0–1), where that point should be, how firmly it
 * is held (0–1), and how far up and down the sheet the hold reaches
 * (`span`, a share of its height): a fingertip, or a hand along the edge.
 * What is held stays level with the spine, as paper between fingers does.
 */
export interface SheetHold {
  readonly u: number;
  readonly v: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly grip: number;
  readonly span: number;
}

/** A press toward lying flat in a pose, by `weight` (0–1) of what remains each substep. */
export interface SheetPress {
  readonly pose: 0 | 1;
  readonly weight: number;
}

export interface Sheet {
  readonly columns: number;
  readonly rows: number;
  /** x, y, z of every particle, row by row from the spine outward. */
  readonly positions: Float32Array;
  /** Lays the sheet out as a flat plate turned `turned` (0–1) of the way over. */
  reset(shape: SheetShape, turned: number): void;
  /** Moves the sheet on by `seconds`, held or not, pressed flat or not. */
  step(seconds: number, hold: SheetHold | null, press: SheetPress | null): void;
  /** How far the farthest particle is from lying flat in `pose`. */
  distanceFromFlat(pose: 0 | 1): number;
  /** The speed of the fastest particle over the last substep, per second. */
  speed(): number;
}

const SUBSTEP = 1 / 480;
/** A frame longer than this many substeps is cut short: the sheet slows instead of leaping. */
const MAX_SUBSTEPS = 16;
/** Gravity, in sheet widths per second squared. */
const GRAVITY = 16;
/** How fast the air takes a particle's speed away, per second. */
const AIR_DRAG = 3.2;

interface SheetState {
  readonly columns: number;
  readonly rows: number;
  readonly positions: Float32Array;
  readonly previous: Float32Array;
  shape: SheetShape;
  links: SheetLinks;
  /** Time not yet simulated, short of a substep. */
  carry: number;
  fastest: number;
}

export function createSheet(columns = 20, rows = 26): Sheet {
  const state: SheetState = {
    columns,
    rows,
    positions: new Float32Array(columns * rows * 3),
    previous: new Float32Array(columns * rows * 3),
    shape: { spine: 0, width: 1, height: 1 },
    links: buildLinks(columns, rows, 1, 1),
    carry: 0,
    fastest: 0,
  };
  return {
    columns,
    rows,
    positions: state.positions,
    reset(shape, turned): void {
      layFlat(state, shape, turned);
    },
    step(seconds, hold, press): void {
      state.carry += Math.min(seconds, MAX_SUBSTEPS * SUBSTEP);
      while (state.carry >= SUBSTEP) {
        state.carry -= SUBSTEP;
        substep(state, hold, press);
      }
    },
    distanceFromFlat: (pose) => distanceFromFlat(state, pose),
    speed: () => state.fastest,
  };
}

/** Where a column lies across the spread when the sheet is flat in `pose`. */
function flatX(state: SheetState, column: number, pose: number): number {
  const reach = (column / (state.columns - 1)) * state.shape.width;
  return pose === 0 ? state.shape.spine + reach : state.shape.spine - reach;
}

function layFlat(state: SheetState, shape: SheetShape, turned: number): void {
  const { columns, rows, positions } = state;
  state.shape = shape;
  state.links = buildLinks(columns, rows, shape.width / (columns - 1), shape.height / (rows - 1));
  state.carry = 0;
  state.fastest = 0;
  const angle = Math.acos(1 - 2 * Math.min(1, Math.max(0, turned)));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const p = (row * columns + column) * 3;
      const reach = (column / (columns - 1)) * shape.width;
      positions[p] = shape.spine + reach * Math.cos(angle);
      positions[p + 1] = (row / (rows - 1)) * shape.height;
      positions[p + 2] = reach * Math.sin(angle);
    }
  }
  state.previous.set(positions);
}

function substep(state: SheetState, hold: SheetHold | null, press: SheetPress | null): void {
  const { columns, rows, positions, previous, shape } = state;
  moveOn(state, press);
  const rowHeight = shape.height / (rows - 1);
  if (hold) applyHold(positions, columns, rows, rowHeight, hold);
  satisfyLinks(positions, state.links);
  boundToSpine(positions, columns, rows, shape);
  if (hold) applyHold(positions, columns, rows, rowHeight, hold);
  restOnPages(positions, previous, columns * rows);
  state.fastest = fastestParticle(positions, previous, columns * rows) / SUBSTEP;
}

/** Each free particle keeps most of its momentum, falls, and yields to a press. */
function moveOn(state: SheetState, press: SheetPress | null): void {
  const { columns, rows, positions, previous, shape } = state;
  const drag = Math.exp(-AIR_DRAG * SUBSTEP);
  const fall = GRAVITY * shape.width * SUBSTEP * SUBSTEP;
  for (let row = 0; row < rows; row += 1) {
    const flatY = (row / (rows - 1)) * shape.height;
    // The first column is the spine: it never moves.
    for (let column = 1; column < columns; column += 1) {
      const p = (row * columns + column) * 3;
      let x = positions[p] ?? 0;
      let y = positions[p + 1] ?? 0;
      let z = positions[p + 2] ?? 0;
      const nextX = x + (x - (previous[p] ?? 0)) * drag;
      const nextY = y + (y - (previous[p + 1] ?? 0)) * drag;
      const nextZ = z + (z - (previous[p + 2] ?? 0)) * drag - fall;
      previous[p] = x;
      previous[p + 1] = y;
      previous[p + 2] = z;
      x = nextX;
      y = nextY;
      z = nextZ;
      if (press) {
        x += (flatX(state, column, press.pose) - x) * press.weight;
        y += (flatY - y) * press.weight;
        z -= z * press.weight;
      }
      positions[p] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;
    }
  }
}

function distanceFromFlat(state: SheetState, pose: 0 | 1): number {
  const { columns, rows, positions } = state;
  let farthest = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const p = (row * columns + column) * 3;
      const dx = (positions[p] ?? 0) - flatX(state, column, pose);
      const dz = positions[p + 2] ?? 0;
      farthest = Math.max(farthest, Math.hypot(dx, dz));
    }
  }
  return farthest;
}

/** Paper does not stretch: no particle is farther from the spine than it is when flat. */
function boundToSpine(
  positions: Float32Array,
  columns: number,
  rows: number,
  shape: SheetShape,
): void {
  for (let row = 0; row < rows; row += 1) {
    const anchor = row * columns * 3;
    const fromX = positions[anchor] ?? 0;
    const fromY = positions[anchor + 1] ?? 0;
    const fromZ = positions[anchor + 2] ?? 0;
    for (let column = 1; column < columns; column += 1) {
      const p = (row * columns + column) * 3;
      const dx = (positions[p] ?? 0) - fromX;
      const dy = (positions[p + 1] ?? 0) - fromY;
      const dz = (positions[p + 2] ?? 0) - fromZ;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const reach = (column / (columns - 1)) * shape.width;
      if (length <= reach) continue;
      const scale = reach / length;
      positions[p] = fromX + dx * scale;
      positions[p + 1] = fromY + dy * scale;
      positions[p + 2] = fromZ + dz * scale;
    }
  }
}

/** The pages beneath stop the sheet, and take most of its sideways slide with them. */
function restOnPages(positions: Float32Array, previous: Float32Array, count: number): void {
  for (let p = 0; p < count * 3; p += 3) {
    if ((positions[p + 2] ?? 0) >= 0) continue;
    positions[p + 2] = 0;
    previous[p + 2] = 0;
    previous[p] = ((previous[p] ?? 0) + (positions[p] ?? 0)) / 2;
    previous[p + 1] = ((previous[p + 1] ?? 0) + (positions[p + 1] ?? 0)) / 2;
  }
}

/**
 * Carries what is held to where it should be: the held point, and the paper
 * above and below it along the same line, less firmly the farther off.
 */
function applyHold(
  positions: Float32Array,
  columns: number,
  rows: number,
  rowHeight: number,
  hold: SheetHold,
): void {
  const column = Math.max(1, Math.round(hold.u * (columns - 1)));
  const centre = Math.round(hold.v * (rows - 1));
  const reach = Math.max(1, Math.round(hold.span * (rows - 1)));
  const first = Math.max(0, centre - reach);
  const last = Math.min(rows - 1, centre + reach);
  for (let row = first; row <= last; row += 1) {
    const away = Math.abs(row - centre) / (reach + 1);
    const share = hold.grip * 0.5 * (1 + Math.cos(Math.PI * away));
    const p = (row * columns + column) * 3;
    const x = positions[p] ?? 0;
    const y = positions[p + 1] ?? 0;
    const z = positions[p + 2] ?? 0;
    positions[p] = x + (hold.x - x) * share;
    positions[p + 1] = y + (hold.y + (row - centre) * rowHeight - y) * share;
    positions[p + 2] = z + (hold.z - z) * share;
  }
}

function fastestParticle(positions: Float32Array, previous: Float32Array, count: number): number {
  let fastest = 0;
  for (let index = 0; index < count * 3; index += 3) {
    const dx = (positions[index] ?? 0) - (previous[index] ?? 0);
    const dy = (positions[index + 1] ?? 0) - (previous[index + 1] ?? 0);
    const dz = (positions[index + 2] ?? 0) - (previous[index + 2] ?? 0);
    fastest = Math.max(fastest, dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(fastest);
}
