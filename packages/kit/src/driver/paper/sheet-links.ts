/**
 * The pairs of a sheet's particles kept a fixed distance apart: neighbours
 * and diagonals, which keep the paper from stretching and shearing, and
 * particles two, four and eight apart, which make it bow in one sweep
 * instead of crumpling.
 */
export interface SheetLinks {
  readonly a: Uint16Array;
  readonly b: Uint16Array;
  readonly rest: Float32Array;
  readonly stiffness: Float32Array;
  /** The share of each correction the first particle takes; one on the spine takes none. */
  readonly shareOfA: Float32Array;
}

const SHEAR_STIFFNESS = 0.85;
const BEND_STIFFNESS = 0.5;
const SWEEP_STIFFNESS = 0.4;
const SPAN_STIFFNESS = 0.3;
/** How far apart, in cells, the particles that resist bending are, and how strongly. */
const BENDS = [
  [2, BEND_STIFFNESS],
  [4, SWEEP_STIFFNESS],
  [8, SPAN_STIFFNESS],
] as const;

type Pair = readonly [a: number, b: number, rest: number, stiffness: number];

/** The links of a grid whose cells are `dx` by `dy`; the first column is the spine. */
export function buildLinks(columns: number, rows: number, dx: number, dy: number): SheetLinks {
  const pairs: Pair[] = [];
  const at = (column: number, row: number): number => row * columns + column;
  const diagonal = Math.hypot(dx, dy);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const here = at(column, row);
      if (column + 1 < columns) pairs.push([here, at(column + 1, row), dx, 1]);
      if (row + 1 < rows) pairs.push([here, at(column, row + 1), dy, 1]);
      if (column + 1 < columns && row + 1 < rows) {
        pairs.push([here, at(column + 1, row + 1), diagonal, SHEAR_STIFFNESS]);
        pairs.push([at(column + 1, row), at(column, row + 1), diagonal, SHEAR_STIFFNESS]);
      }
      for (const [cells, stiffness] of BENDS) {
        if (column + cells < columns)
          pairs.push([here, at(column + cells, row), dx * cells, stiffness]);
        if (row + cells < rows) pairs.push([here, at(column, row + cells), dy * cells, stiffness]);
      }
    }
  }
  // Two particles both on the spine hold each other already.
  const free = pairs.filter(([a, b]) => a % columns !== 0 || b % columns !== 0);
  return {
    a: Uint16Array.from(free, (pair) => pair[0]),
    b: Uint16Array.from(free, (pair) => pair[1]),
    rest: Float32Array.from(free, (pair) => pair[2]),
    stiffness: Float32Array.from(free, (pair) => pair[3]),
    shareOfA: Float32Array.from(free, ([a, b]) =>
      a % columns === 0 ? 0 : b % columns === 0 ? 1 : 0.5,
    ),
  };
}

/** Moves each linked pair toward its distance, once. */
export function satisfyLinks(positions: Float32Array, links: SheetLinks): void {
  const { a: first, b: second, rest, stiffness, shareOfA } = links;
  for (let link = 0; link < first.length; link += 1) {
    const a = (first[link] ?? 0) * 3;
    const b = (second[link] ?? 0) * 3;
    const ax = positions[a] ?? 0;
    const ay = positions[a + 1] ?? 0;
    const az = positions[a + 2] ?? 0;
    const dx = (positions[b] ?? 0) - ax;
    const dy = (positions[b + 1] ?? 0) - ay;
    const dz = (positions[b + 2] ?? 0) - az;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-6) continue;
    const correction = ((length - (rest[link] ?? 0)) / length) * (stiffness[link] ?? 0);
    const toA = correction * (shareOfA[link] ?? 0);
    const toB = correction - toA;
    positions[a] = ax + dx * toA;
    positions[a + 1] = ay + dy * toA;
    positions[a + 2] = az + dz * toA;
    positions[b] = ax + dx - dx * toB;
    positions[b + 1] = ay + dy - dy * toB;
    positions[b + 2] = az + dz - dz * toB;
  }
}
