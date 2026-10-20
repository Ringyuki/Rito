import { describe, expect, it } from 'vitest';
import { sheetGrid } from '../src/driver/paper/mesh';

describe('the grid a sheet is drawn on', () => {
  it('is told to the GPU as triangles between its points', () => {
    const COLUMNS = 64;
    const ROWS = 48;
    const grid = sheetGrid(COLUMNS, ROWS);
    expect(grid.indices.length).toBe((COLUMNS - 1) * (ROWS - 1) * 6);
    expect(Math.max(...grid.indices)).toBe(COLUMNS * ROWS - 1);
    expect(Array.from(grid.uvs.slice(-2))).toEqual([1, 1]);
    // And the same triangles from the bottom row up, each row still from the spine outward.
    const aRow = (COLUMNS - 1) * 6;
    expect(grid.fromBelow.length).toBe(grid.indices.length);
    expect(Array.from(grid.fromBelow.slice(0, aRow))).toEqual(
      Array.from(grid.indices.slice(-aRow)),
    );
    expect(Array.from(grid.fromBelow.slice(-aRow))).toEqual(
      Array.from(grid.indices.slice(0, aRow)),
    );
  });
});
