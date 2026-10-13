import { describe, expect, it } from 'vitest';
import { behind, curlThrough, layCurl, lineAt } from '../src/driver/paper/curl';
import { curledFlat, isThere, layCurled, wantedCurled } from '../src/driver/paper/curled';
import { paperBeneathFirst } from '../src/driver/paper/draw-sheet';
import { fly, GONE_BY, type Leaf } from '../src/driver/paper/leaves';
import { sheetGrid } from '../src/driver/paper/mesh';
import type { PaperSheet } from '../src/driver/paper/renderer';
import type { TransitionFrame } from '../src/driver/effects';
import {
  at,
  COLUMNS,
  forward,
  frame,
  laid,
  page,
  ROLL_RADIUS,
  ROWS,
  scene,
  sheet,
} from './helpers/curled-page';

const apart = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

describe('a page curled over on itself', () => {
  it('is not stretched: neighbouring points stay as far apart as they lie flat', () => {
    for (const [shown, lean] of [
      [0.3, 0],
      [0.25, 0.7],
      [0.6, -0.5],
      [0.93, 0.4],
    ] as const) {
      const positions = laid(shown, lean);
      const across = page.width / (COLUMNS - 1);
      const down = page.height / (ROWS - 1);
      let worst = 0;
      for (let row = 0; row < ROWS - 1; row += 7) {
        for (let column = 0; column < COLUMNS - 1; column += 1) {
          const here = at(positions, column, row);
          worst = Math.max(worst, Math.abs(apart(here, at(positions, column + 1, row)) - across));
          worst = Math.max(worst, Math.abs(apart(here, at(positions, column, row + 1)) - down));
        }
      }
      // A chord across the roll is shorter than the paper round it by a few thousandths.
      expect(worst).toBeLessThan(0.02);
    }
  });

  it('lies flat until its turn begins, whichever way its line leans', () => {
    for (const lean of [0, 0.3, 0.9, -0.9]) {
      const positions = laid(0, lean);
      for (let index = 2; index < positions.length; index += 3) expect(positions[index]).toBe(0);
      expect(at(positions, COLUMNS - 1, ROWS - 1)).toEqual([400, 600, 0]);
    }
    // A hair into its turn only a corner has left the page, or a strip of its edge.
    const corner = laid(0.01, 0.9);
    expect(at(corner, COLUMNS - 1, ROWS - 1)[2]).toBeGreaterThan(0);
    expect(at(corner, COLUMNS - 1, 0)[2]).toBe(0);
    expect(at(corner, COLUMNS - 12, ROWS - 1)[2]).toBe(0);
  });

  it('never leaves the spine: its line stays right of both ends of it', () => {
    for (let shown = 0; shown <= 1.0001; shown += 0.05) {
      for (const lean of [-2, -0.4, 0, 0.6, 2]) {
        const line = lineAt(page, shown, lean);
        expect(Math.min(line.top, line.bottom)).toBeCloseTo(400 * (1 - Math.min(1, shown)), 9);
        expect(line.top).toBeGreaterThanOrEqual(0);
        expect(line.bottom).toBeGreaterThanOrEqual(0);
        const positions = laid(shown, lean);
        // The paper bound at the spine lies where it lay.
        expect(at(positions, 0, 0)).toEqual([0, 0, 0]);
        expect(at(positions, 0, ROWS - 1)).toEqual([0, 600, 0]);
      }
    }
  });

  it('is out of the frame once turned, lying flat past the spine with no roll left', () => {
    for (const lean of [0, 0.8, -0.8]) {
      expect(curlThrough(page, lineAt(page, 1, lean)).radius).toBe(0);
      const positions = laid(1, lean);
      for (let index = 0; index < positions.length; index += 3) {
        expect(positions[index]).toBeLessThanOrEqual(1e-9);
        expect(positions[index + 2]).toBe(0);
      }
    }
  });

  it('rolls at one radius until its line nears the spine, and tightens evenly from there', () => {
    let before = curlThrough(page, lineAt(page, 0, 0.5));
    expect(before.radius).toBeCloseTo(ROLL_RADIUS, 9);
    for (let shown = 0.002; shown <= 1; shown += 0.002) {
      const now = curlThrough(page, lineAt(page, shown, 0.5));
      expect(now.radius).toBeLessThanOrEqual(ROLL_RADIUS + 1e-9);
      // No step in the radius, nor in where the line lies or how it leans.
      expect(Math.abs(now.radius - before.radius)).toBeLessThan(0.6);
      // The end that trails comes in faster than the one that leads once the line must stand up.
      expect(Math.abs(now.at - before.at)).toBeLessThan(2.5);
      expect(Math.abs(now.dy - before.dy)).toBeLessThan(0.01);
      before = now;
    }
    expect(before.radius).toBeLessThan(0.6);
  });

  it('carries its lifted edge twice as far as its line goes, once it lies on top of its roll', () => {
    const middle = Math.floor(ROWS / 2);
    const [early] = at(laid(0.5, 0), COLUMNS - 1, middle);
    const [later] = at(laid(0.6, 0), COLUMNS - 1, middle);
    // A tenth of a turn: the line comes in 40, the edge lying on top 80.
    // Positions are kept in single precision, which at 300 or so is good to a few millionths.
    expect(later - early).toBeCloseTo(-80, 4);
    expect(at(laid(0.6, 0), COLUMNS - 1, middle)[2]).toBeCloseTo(2 * ROLL_RADIUS, 6);
  });

  it('lifts no farther than the page lying on it has', () => {
    const front = lineAt(page, 0.3, 0.6);
    const own = lineAt(page, 0.5, 0);
    const kept = behind(own, front);
    expect(kept.top).toBe(front.top);
    expect(kept.bottom).toBe(front.bottom);
    // Where the page in front has not lifted, at its trailing end, the one behind cannot either.
    expect(behind(lineAt(page, 0.1, 0), front)).toEqual({ top: front.top, bottom: 360 });
    // Where it has not caught the page in front up at all, it is its own.
    expect(behind(lineAt(page, 0.1, 0), lineAt(page, 0.3, 0))).toEqual(lineAt(page, 0.1, 0));
    // A page in front that is turned and gone holds nothing back.
    expect(behind(own, lineAt(page, 1, 0.6))).toEqual(own);
    // As the page in front goes on, the one behind follows without a step.
    let last = behind(own, lineAt(page, 0.3, 0.6));
    for (let shown = 0.3; shown <= 1; shown += 0.005) {
      const now = behind(own, lineAt(page, shown, 0.6));
      expect(Math.abs(now.top - last.top) + Math.abs(now.bottom - last.bottom)).toBeLessThan(8);
      last = now;
    }
    expect(last).toEqual(own);
  });
});

/** Draws the page where it is wanted a frame on, as the effect does. */
function follow(leaf: Leaf, of: TransitionFrame, turned: number): number {
  const curled = leaf.curled;
  if (!curled) throw new Error('not a curled page');
  leaf.shown = wantedCurled(leaf, curled, scene, of, forward(turned), 1 / 60);
  return leaf.shown;
}

describe('how a curled page no finger moves keeps step with its turn', () => {
  it('turned by a key, sweeps across upright and is gone before its turn stops', () => {
    const leaf = sheet(0);
    expect(follow(leaf, frame('landing'), 0)).toBe(0);
    let last = 0;
    for (let turned = 0.01; turned < GONE_BY; turned += 0.01) {
      const now = follow(leaf, frame('landing'), turned);
      expect(now).toBeGreaterThan(last);
      expect(leaf.curled?.lean).toBe(0);
      expect(isThere(leaf)).toBe(false);
      last = now;
    }
    expect(follow(leaf, frame('landing'), GONE_BY)).toBe(1);
    // It is where its turn takes it, with the turn still on its way.
    expect(isThere(leaf)).toBe(true);
  });

  it('goes on from where it is when what moves its turn changes', () => {
    const leaf = sheet(0);
    follow(leaf, frame('landing'), 0.02);
    const ahead = follow(leaf, frame('landing'), 0.4);
    // Sent back while still going on: it keeps going with its turn, then comes back with it.
    expect(follow(leaf, frame('returning'), 0.4)).toBeCloseTo(ahead, 6);
    expect(follow(leaf, frame('returning'), 0.44)).toBeGreaterThan(ahead);
    expect(follow(leaf, frame('returning'), 0.2)).toBeCloseTo(ahead / 2, 6);
    expect(isThere(leaf)).toBe(false);
    expect(follow(leaf, frame('returning'), 0)).toBe(0);
    expect(isThere(leaf)).toBe(true);
  });

  it('gone from the frame with its turn still on its way, stays gone until the turn has come back for it', () => {
    const leaf = sheet(0);
    follow(leaf, frame('landing'), 0.02);
    expect(follow(leaf, frame('landing'), 0.9)).toBe(1);
    // Sent back: the turn goes on a little, turns round, and the page comes in with it.
    expect(follow(leaf, frame('returning'), 0.9)).toBe(1);
    expect(follow(leaf, frame('returning'), 0.94)).toBe(1);
    expect(follow(leaf, frame('returning'), 0.45)).toBeCloseTo(0.5, 6);
  });

  it('let go where there is no page to turn to, comes back in step with its turn', () => {
    const leaf = sheet(0);
    const end = (phase: TransitionFrame['phase'], x: number): TransitionFrame => ({
      ...frame(phase, [300, x, 300]),
      incoming: null,
    });
    // The turn is the pull as the end of the book resists it: 100 px of finger, 40 of turn.
    follow(leaf, end('held', 340), 0.02);
    follow(leaf, end('held', 280), 0.05);
    const held = leaf.shown;
    expect(held).toBeGreaterThan(0);
    // Nothing comes to the finger there: a pull twice as hard is twice the turn, no more.
    expect(leaf.curled?.held?.setOff).toBe(false);
    expect(follow(leaf, end('returning', 280), 0.05)).toBeCloseTo(held, 6);
    expect(leaf.flight).toBeNull();
    expect(follow(leaf, end('returning', 280), 0.025)).toBeCloseTo(held / 2, 6);
    expect(follow(leaf, end('returning', 280), 0)).toBe(0);
  });

  it('finishes by itself when its turn is at its end and it is not', () => {
    const leaf = sheet(0.5);
    // Its turn is all but over: nothing is left to carry it there.
    const stays = follow(leaf, frame('landing'), 0.995);
    expect(stays).toBe(0.5);
    expect(leaf.flight?.to).toBe(1);
    // And it is left to that until it is there: its own way is not begun again.
    fly(leaf, 0.05);
    const onItsWay = leaf.shown;
    expect(onItsWay).toBeGreaterThan(0.5);
    expect(follow(leaf, frame('landing'), 1)).toBe(onItsWay);
    expect(leaf.flight?.elapsed).toBe(0.05);
  });

  it('lays a page behind another no farther over than the one in front', () => {
    const front = sheet(0.3, { ...curledFlat(), lean: 0.6 }, 5);
    const back = sheet(0.5, curledFlat(), 6);
    layCurled([front, back], COLUMNS, ROWS);
    const line = lineAt(page, 0.3, 0.6);
    expect(back.curled?.curl).toEqual(curlThrough(page, line));
    // By itself it would have gone farther.
    const alone = sheet(0.5, curledFlat(), 6);
    layCurled([alone], COLUMNS, ROWS);
    expect(alone.curled?.curl?.at).toBeLessThan(back.curled?.curl?.at ?? 0);
  });
});

describe('the order a curled page is drawn in', () => {
  const columns = 41;
  const rows = 61;
  const grid = sheetGrid(columns, rows);

  /** A page curled over, and the middle of each cell of it in the order its lifted part is drawn. */
  function drawn(lean: number): { sheet: PaperSheet; cells: [number, number, number][] } {
    const positions = new Float32Array(columns * rows * 3);
    const normals = new Float32Array(columns * rows * 3);
    const curl = curlThrough(page, lineAt(page, 0.45, lean));
    layCurl(page, curl, columns, rows, positions, normals);
    const sheet: PaperSheet = { positions, normals, front: null, back: null, shown: 0.45, curl };
    const order =
      paperBeneathFirst(sheet, 'lifted') === 'fromBelow' ? grid.fromBelow : grid.indices;
    const cells: [number, number, number][] = [];
    for (let first = 0; first < order.length; first += 6) {
      // The four corners of a cell: its first triangle, and the last point of its second.
      const corners = [0, 1, 2, 5].map((corner) => (order[first + corner] ?? 0) * 3);
      const middle = (axis: number): number =>
        corners.reduce((sum, corner) => sum + (positions[corner + axis] ?? 0), 0) / 4;
      cells.push([middle(0), middle(1), middle(2)]);
    }
    return { sheet, cells };
  }

  it('draws the paper beneath before the paper lying over it, whichever corner it is rolled back from', () => {
    for (const lean of [0.5, 0, -0.5]) {
      const { cells } = drawn(lean);
      let lyingOver = 0;
      let drawnFirst = 0;
      cells.forEach((later, index) => {
        for (const earlier of cells.slice(0, index)) {
          const over = Math.abs(later[0] - earlier[0]) < 4 && Math.abs(later[1] - earlier[1]) < 4;
          if (!over || Math.abs(later[2] - earlier[2]) < 1) continue;
          lyingOver += 1;
          if (later[2] < earlier[2]) drawnFirst += 1;
        }
      });
      // The paper does lie over itself, and nowhere is what lies on top drawn first.
      expect(lyingOver).toBeGreaterThan(20);
      expect(drawnFirst).toBe(0);
    }
  });

  it('draws what still lies on the pages, and a leaf, from the top row down', () => {
    const { sheet } = drawn(-0.5);
    expect(paperBeneathFirst(sheet, 'lifted')).toBe('fromBelow');
    expect(paperBeneathFirst(sheet, 'lying')).toBe('fromAbove');
    const { positions, normals } = sheet;
    const leaf: PaperSheet = { positions, normals, front: null, back: null, shown: 0.45 };
    expect(paperBeneathFirst(leaf, 'whole')).toBe('fromAbove');
  });
});
