import type { PaperTurnModel } from '@ritojs/core';
import { describe, expect, it } from 'vitest';
import { paperBeneathFirst } from '../src/driver/paper/draw-sheet';
import { sheetGrid } from '../src/driver/paper/mesh';
import type { PaperSheet } from '../src/driver/paper/renderer';
import { engineBuilt, paperTurnModel } from './helpers/engine';

/**
 * A page of a spread one page wide, curled over by a finger that took it at
 * its outer edge `y` down and has carried it half way, held there until it
 * has come to the finger: the sheet as the engine lays it out.
 */
async function curledBy(y: number): Promise<{ sheet: PaperSheet; columns: number; rows: number }> {
  const model: PaperTurnModel = await paperTurnModel();
  const touchAt = (x: number) => ({ origin: { x: 388, y }, position: { x, y } });
  let laid = null;
  for (let step = 0; step <= 40; step += 1) {
    const touch = touchAt(388 - 180 * Math.min(1, step / 20));
    const begun = model.begin({
      width: 400,
      height: 600,
      spine: 0,
      cssPixel: 1,
      dx: model.travel(touch, 400, 0),
      incoming: 'next',
      phase: 'held',
      touch,
      current: { spread: 5, buffer: 1 },
      incomingPage: { spread: 6, buffer: 2 },
      now: step * 16,
      epoch: 0,
    });
    if (begun.kind !== 'turn') throw new Error('a page turns');
    laid = model.lay(0);
  }
  if (!laid) throw new Error('a frame is laid out');
  for (let index = 0; index < laid.sheets; index += 1) {
    const { curl, shown } = model.sheet(index);
    if (!curl) continue;
    const positions = new Float32Array(laid.columns * laid.rows * 3);
    const normals = new Float32Array(laid.columns * laid.rows * 3);
    model.points(index, positions, normals);
    const sheet = { positions, normals, front: null, back: null, shown, curl };
    return { sheet, columns: laid.columns, rows: laid.rows };
  }
  throw new Error('a page is curled over');
}

/** The middle of each cell of a sheet, in the order its lifted part is drawn. */
function cellsDrawn(sheet: PaperSheet, columns: number, rows: number): [number, number, number][] {
  const grid = sheetGrid(columns, rows);
  const order = paperBeneathFirst(sheet, 'lifted') === 'fromBelow' ? grid.fromBelow : grid.indices;
  const cells: [number, number, number][] = [];
  for (let first = 0; first < order.length; first += 6) {
    // The four corners of a cell: its first triangle, and the last point of its second.
    const corners = [0, 1, 2, 5].map((corner) => (order[first + corner] ?? 0) * 3);
    const middle = (axis: number): number =>
      corners.reduce((sum, corner) => sum + (sheet.positions[corner + axis] ?? 0), 0) / 4;
    cells.push([middle(0), middle(1), middle(2)]);
  }
  return cells;
}

describe.skipIf(!engineBuilt)('the order a curled page is drawn in', () => {
  it('draws the paper beneath before the paper lying over it, whichever corner it is rolled back from', async () => {
    for (const y of [30, 300, 570]) {
      const { sheet, columns, rows } = await curledBy(y);
      const cells = cellsDrawn(sheet, columns, rows);
      // Cells over each other: closer across the page than 0.4 of a cell,
      // which a neighbouring cell never is. Looked for by squares that wide.
      const reach = 0.4 * Math.min(400 / (columns - 1), 600 / (rows - 1));
      const near = new Map<string, number[]>();
      const square = (x: number, y: number): string =>
        `${String(Math.floor(x / reach))},${String(Math.floor(y / reach))}`;
      let lyingOver = 0;
      let drawnFirst = 0;
      cells.forEach((later, index) => {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (const at of near.get(square(later[0] + dx * reach, later[1] + dy * reach)) ?? []) {
              const earlier = cells[at] ?? later;
              const over =
                Math.abs(later[0] - earlier[0]) < reach && Math.abs(later[1] - earlier[1]) < reach;
              if (!over || Math.abs(later[2] - earlier[2]) < 1) continue;
              lyingOver += 1;
              if (later[2] < earlier[2]) drawnFirst += 1;
            }
          }
        }
        const key = square(later[0], later[1]);
        near.set(key, [...(near.get(key) ?? []), index]);
      });
      // The paper does lie over itself, and nowhere is what lies on top drawn first.
      expect(lyingOver).toBeGreaterThan(20);
      expect(drawnFirst).toBe(0);
    }
  });

  it('draws what still lies on the pages, and a leaf, from the top row down', async () => {
    // Taken by its top corner, the page is rolled back from it.
    const { sheet } = await curledBy(30);
    expect(sheet.curl?.dy).toBeLessThan(0);
    expect(paperBeneathFirst(sheet, 'lifted')).toBe('fromBelow');
    expect(paperBeneathFirst(sheet, 'lying')).toBe('fromAbove');
    const { positions, normals } = sheet;
    const leaf: PaperSheet = { positions, normals, front: null, back: null, shown: 0.45 };
    expect(paperBeneathFirst(leaf, 'whole')).toBe('fromAbove');
  });
});
