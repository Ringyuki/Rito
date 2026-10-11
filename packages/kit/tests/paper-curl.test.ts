import { describe, expect, it } from 'vitest';
import { foldBetween, layOut, withinReach, type Fold } from '../src/driver/paper/curl';
import { sheetGrid } from '../src/driver/paper/mesh';

const shape = { spine: 400, width: 400, height: 600 };
const COLUMNS = 41;
const ROWS = 31;
const corner = { x: 800, y: 600 };

function laidOut(fold: Fold | null): { positions: Float32Array; normals: Float32Array } {
  const positions = new Float32Array(COLUMNS * ROWS * 3);
  const normals = new Float32Array(COLUMNS * ROWS * 3);
  layOut(shape, fold, COLUMNS, ROWS, positions, normals);
  return { positions, normals };
}

function point(values: Float32Array, column: number, row: number): [number, number, number] {
  const p = (row * COLUMNS + column) * 3;
  return [values[p] ?? 0, values[p + 1] ?? 0, values[p + 2] ?? 0];
}

function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  );
}

describe('a sheet rolled back over itself', () => {
  it('lies flat, face up, with no fold', () => {
    const { positions, normals } = laidOut(null);
    expect(point(positions, 0, 0)).toEqual([400, 0, 0]);
    expect(point(positions, COLUMNS - 1, ROWS - 1)).toEqual([800, 600, 0]);
    expect(point(normals, 20, 15)).toEqual([0, 0, 1]);
    expect(foldBetween(corner, corner, 30, shape)).toBeNull();
  });

  it('carries the held point to where it is taken, on top of the roll', () => {
    const to = { x: 520, y: 430 };
    const fold = foldBetween(corner, to, 30, shape);
    const [x, y, z] = point(laidOut(fold).positions, COLUMNS - 1, ROWS - 1);
    expect(x).toBeCloseTo(to.x, 3);
    expect(y).toBeCloseTo(to.y, 3);
    expect(z).toBeCloseTo(60, 4);
  });

  it('bends without stretching: neighbours stay as far apart as they are flat', () => {
    const fold = foldBetween(corner, { x: 500, y: 380 }, 36, shape);
    const { positions } = laidOut(fold);
    const flat = laidOut(null).positions;
    let worst = 0;
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column + 1 < COLUMNS; column += 1) {
        const now = apart(point(positions, column, row), point(positions, column + 1, row));
        const was = apart(point(flat, column, row), point(flat, column + 1, row));
        worst = Math.max(worst, Math.abs(now / was - 1));
      }
    }
    // A step round the roll is a chord of it: shorter than its arc by a hair.
    expect(worst).toBeLessThan(0.005);
  });

  it('rolls round: face up, on edge at the top of the roll, face down beyond', () => {
    const fold = foldBetween({ x: 800, y: 300 }, { x: 500, y: 300 }, 40, shape);
    if (!fold) throw new Error('the point was moved');
    const { positions, normals } = laidOut(fold);
    const facing = Array.from({ length: COLUMNS }, (_, column) => point(normals, column, 15)[2]);
    expect(facing[0]).toBe(1);
    expect(facing[COLUMNS - 1]).toBe(-1);
    // Facing never turns back on its way round.
    for (let column = 1; column < COLUMNS; column += 1) {
      expect(facing[column] ?? 0).toBeLessThanOrEqual((facing[column - 1] ?? 0) + 1e-6);
    }
    const heights = Array.from({ length: COLUMNS }, (_, column) => point(positions, column, 15)[2]);
    expect(Math.max(...heights)).toBeCloseTo(80, 4);
    expect(Math.min(...heights)).toBe(0);
  });

  it('never lifts the paper bound at the spine, wherever the point is taken', () => {
    for (const wanted of [
      { x: -900, y: -500 },
      { x: 300, y: 1400 },
      { x: 420, y: 60 },
      { x: 0, y: 600 },
    ]) {
      const to = withinReach(corner, wanted, shape);
      expect(Math.hypot(to.x - 400, to.y - 600)).toBeLessThanOrEqual(400 + 1e-6);
      expect(Math.hypot(to.x - 400, to.y)).toBeLessThanOrEqual(Math.hypot(400, 600) + 1e-6);
      const { positions } = laidOut(foldBetween(corner, to, 30, shape));
      for (let row = 0; row < ROWS; row += 1) {
        const [x, y, z] = point(positions, 0, row);
        expect([x, z]).toEqual([400, 0]);
        expect(y).toBeCloseTo((row / (ROWS - 1)) * 600, 3);
      }
    }
    expect(withinReach(corner, { x: 600, y: 500 }, shape)).toEqual({ x: 600, y: 500 });
  });

  it('lies flat on the far side, face down, once the point is carried across the spine', () => {
    const { positions, normals } = laidOut(foldBetween(corner, { x: 0, y: 600 }, 0, shape));
    for (const [column, row] of [
      [0, 0],
      [13, 7],
      [COLUMNS - 1, ROWS - 1],
    ] as const) {
      const [x, y, z] = point(positions, column, row);
      expect(x).toBeCloseTo(400 - (column / (COLUMNS - 1)) * 400, 3);
      expect(y).toBeCloseTo((row / (ROWS - 1)) * 600, 3);
      expect(z).toBe(0);
      expect(point(normals, column, row)).toEqual([0, 0, -1]);
    }
  });

  it('is told to the GPU as triangles between its points', () => {
    const grid = sheetGrid(COLUMNS, ROWS);
    expect(grid.indices.length).toBe((COLUMNS - 1) * (ROWS - 1) * 6);
    expect(Math.max(...grid.indices)).toBe(COLUMNS * ROWS - 1);
    expect(Array.from(grid.uvs.slice(-2))).toEqual([1, 1]);
  });
});
