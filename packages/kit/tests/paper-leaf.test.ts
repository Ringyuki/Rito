import { describe, expect, it } from 'vitest';
import { layLeaf, leafPoint, poseAt, type LeafGrab } from '../src/driver/paper/leaf';
import { sheetGrid } from '../src/driver/paper/mesh';

const shape = { spine: 400, width: 400, height: 600 };
const COLUMNS = 33;
const ROWS = 25;
const byCorner: LeafGrab = { u: 1, v: 1 };
const byEdge: LeafGrab = { u: 1, v: 0.5 };

function laid(grab: LeafGrab, turned: number): { positions: Float32Array; normals: Float32Array } {
  const positions = new Float32Array(COLUMNS * ROWS * 3);
  const normals = new Float32Array(COLUMNS * ROWS * 3);
  layLeaf(shape, poseAt(shape, grab, turned), COLUMNS, ROWS, positions, normals);
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

describe('a leaf turned about the spine', () => {
  it('lies flat, face up, before it is turned', () => {
    const { positions, normals } = laid(byCorner, 0);
    for (const [column, row] of [
      [0, 0],
      [11, 7],
      [COLUMNS - 1, ROWS - 1],
    ] as const) {
      const [x, y, z] = point(positions, column, row);
      expect(x).toBeCloseTo(400 + (column / (COLUMNS - 1)) * 400, 3);
      expect(y).toBeCloseTo((row / (ROWS - 1)) * 600, 3);
      expect(z).toBeCloseTo(0, 3);
      expect(point(normals, column, row)[2]).toBeCloseTo(1, 5);
    }
  });

  it('lies flat on the far side, face down, once turned', () => {
    const { positions, normals } = laid(byCorner, 1);
    for (const [column, row] of [
      [0, 0],
      [11, 7],
      [COLUMNS - 1, ROWS - 1],
    ] as const) {
      const [x, y, z] = point(positions, column, row);
      expect(x).toBeCloseTo(400 - (column / (COLUMNS - 1)) * 400, 2);
      expect(y).toBeCloseTo((row / (ROWS - 1)) * 600, 2);
      expect(z).toBeCloseTo(0, 2);
      expect(point(normals, column, row)[2]).toBeCloseTo(-1, 4);
    }
  });

  it('stays bound at the spine all the way over', () => {
    for (let turned = 0; turned <= 1; turned += 0.05) {
      for (const down of [0, 220, 600]) {
        const [x, y, z] = leafPoint(shape, poseAt(shape, byCorner, turned), 0, down);
        expect([x, z]).toEqual([400, 0]);
        expect(y).toBeCloseTo(down, 6);
      }
    }
  });

  it('bends without stretching: neighbours stay as far apart as they are flat', () => {
    const flat = laid(byCorner, 0).positions;
    for (const grab of [byCorner, byEdge, { u: 1, v: 0.1 }]) {
      for (const turned of [0.12, 0.35, 0.5, 0.7, 0.93]) {
        const { positions } = laid(grab, turned);
        let worst = 0;
        for (let row = 0; row + 1 < ROWS; row += 1) {
          for (let column = 0; column + 1 < COLUMNS; column += 1) {
            for (const [dc, dr] of [
              [1, 0],
              [0, 1],
            ] as const) {
              const now = apart(
                point(positions, column, row),
                point(positions, column + dc, row + dr),
              );
              const was = apart(point(flat, column, row), point(flat, column + dc, row + dr));
              worst = Math.max(worst, Math.abs(now / was - 1));
            }
          }
        }
        // A step round the bend is a chord of it: shorter than its arc by a hair.
        expect(worst).toBeLessThan(0.004);
      }
    }
  });

  it('arches in the air however it is taken: off the straight line from the spine to its edge', () => {
    for (const grab of [byEdge, byCorner, { u: 1, v: 0 }]) {
      const { positions } = laid(grab, 0.3);
      const row = Math.floor(ROWS / 2);
      const edge = point(positions, COLUMNS - 1, row);
      const middle = point(positions, (COLUMNS - 1) / 2, row);
      const spine = point(positions, 0, row);
      const onLine = spine.map((value, axis) => (value + (edge[axis] ?? 0)) / 2);
      // A tenth of the leaf's width, give or take.
      expect(apart(middle, onLine)).toBeGreaterThan(30);
      expect(apart(middle, onLine)).toBeLessThan(60);
    }
  });

  it('leads with the corner it is taken by', () => {
    const { positions } = laid(byCorner, 0.3);
    const bottom = point(positions, COLUMNS - 1, ROWS - 1);
    const top = point(positions, COLUMNS - 1, 0);
    expect(bottom[0]).toBeLessThan(top[0] - 20);
    expect(bottom[2]).toBeGreaterThan(top[2]);
  });

  it('never goes under the pages, and comes down edge first', () => {
    for (const grab of [byCorner, byEdge]) {
      for (let turned = 0; turned <= 1.0001; turned += 0.01) {
        const { positions } = laid(grab, turned);
        let lowest = Infinity;
        for (let index = 2; index < positions.length; index += 3) {
          lowest = Math.min(lowest, positions[index] ?? 0);
        }
        expect(lowest).toBeGreaterThan(-0.05);
      }
    }
    // Near the end the outer corner is down while the middle of the leaf still stands off the page.
    const { positions } = laid(byCorner, 0.93);
    expect(point(positions, COLUMNS - 1, ROWS - 1)[2]).toBeLessThan(1);
    expect(point(positions, (COLUMNS - 1) / 2, ROWS - 1)[2]).toBeGreaterThan(8);
  });

  it('swings evenly, and is flat at both ends of the turn', () => {
    expect(poseAt(shape, byCorner, 0)).toMatchObject({ swing: 0, cone: Math.PI / 2 });
    expect(poseAt(shape, byCorner, 0.5).swing).toBeCloseTo(Math.PI / 2, 9);
    const end = poseAt(shape, byCorner, 1);
    expect(end.swing).toBeCloseTo(Math.PI, 9);
    expect(end.cone).toBeCloseTo(Math.PI / 2, 4);
    // Taken by the middle of its edge it bends round a point much farther off.
    expect(Math.abs(poseAt(shape, byEdge, 0.4).apex)).toBeGreaterThan(
      Math.abs(poseAt(shape, byCorner, 0.4).apex) * 2,
    );
  });

  it('is told to the GPU as triangles between its points', () => {
    const grid = sheetGrid(COLUMNS, ROWS);
    expect(grid.indices.length).toBe((COLUMNS - 1) * (ROWS - 1) * 6);
    expect(Math.max(...grid.indices)).toBe(COLUMNS * ROWS - 1);
    expect(Array.from(grid.uvs.slice(-2))).toEqual([1, 1]);
  });
});
