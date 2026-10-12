import { describe, expect, it } from 'vitest';
import type { TransitionFrame, TransitionScene } from '../src/driver/effects';
import { behind, curlThrough, layCurl, lineAt, type CurlLine } from '../src/driver/paper/curl';
import { curledFlat, layCurled, wantedCurled, type Curled } from '../src/driver/paper/curled';
import { paperBeneathFirst } from '../src/driver/paper/draw-sheet';
import type { LeafShape } from '../src/driver/paper/leaf';
import { fly, GONE_BY, type Leaf } from '../src/driver/paper/leaves';
import { sheetGrid } from '../src/driver/paper/mesh';
import type { PaperSheet } from '../src/driver/paper/renderer';
import type { LeafTurn } from '../src/driver/paper/swing';

const page: LeafShape = { spine: 0, width: 400, height: 600 };
const COLUMNS = 201;
const ROWS = 151;

function laid(shown: number, lean: number, line?: CurlLine): Float32Array {
  const positions = new Float32Array(COLUMNS * ROWS * 3);
  const normals = new Float32Array(COLUMNS * ROWS * 3);
  const curl = curlThrough(page, line ?? lineAt(page, shown, lean));
  layCurl(page, curl, COLUMNS, ROWS, positions, normals);
  return positions;
}

const at = (positions: Float32Array, column: number, row: number): [number, number, number] => {
  const p = (row * COLUMNS + column) * 3;
  return [positions[p] ?? 0, positions[p + 1] ?? 0, positions[p + 2] ?? 0];
};
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
    expect(before.radius).toBeCloseTo(0.05 * 400, 9);
    for (let shown = 0.002; shown <= 1; shown += 0.002) {
      const now = curlThrough(page, lineAt(page, shown, 0.5));
      expect(now.radius).toBeLessThanOrEqual(0.05 * 400 + 1e-9);
      // No step in the radius, nor in where the line lies or how it leans.
      expect(Math.abs(now.radius - before.radius)).toBeLessThan(0.6);
      // The end that trails comes in faster than the one that leads once the line must stand up.
      expect(Math.abs(now.at - before.at)).toBeLessThan(2.5);
      expect(Math.abs(now.dy - before.dy)).toBeLessThan(0.01);
      before = now;
    }
    expect(before.radius).toBeLessThan(0.6);
  });

  it('carries its lifted edge twice as far as its line goes', () => {
    const middle = Math.floor(ROWS / 2);
    const [early] = at(laid(0.2, 0), COLUMNS - 1, middle);
    const [later] = at(laid(0.3, 0), COLUMNS - 1, middle);
    // A tenth of a turn: the line comes in 40, the edge lying on top 80.
    expect(later - early).toBeCloseTo(-80, 6);
    expect(at(laid(0.3, 0), COLUMNS - 1, middle)[2]).toBeCloseTo(2 * 0.05 * 400, 6);
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

const scene = { width: 400, height: 600, spine: 0 } as TransitionScene;

function sheet(shown: number, curled: Curled = curledFlat(), spread = 5): Leaf {
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

const forward = (turned: number): LeafTurn => ({
  spread: 5,
  forward: true,
  turned,
  front: null,
  after: null,
});
const frame = (
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

/** Draws the page where it is wanted, as the effect does. */
function follow(leaf: Leaf, at: TransitionFrame, turned: number): number {
  const curled = leaf.curled;
  if (!curled) throw new Error('not a curled page');
  leaf.shown = wantedCurled(leaf, curled, scene, at, forward(turned));
  return leaf.shown;
}

/** Where a point in the air shows, as the eye over the middle of the frame sees it. */
const EYE = 2.4 * 600;
const seen = ([x, y, z]: readonly number[]): [number, number] => [
  200 + (((x ?? 0) - 200) * EYE) / (EYE - (z ?? 0)),
  300 + (((y ?? 0) - 300) * EYE) / (EYE - (z ?? 0)),
];

/** How far the page's free edge shows from where it lies flat, at the height `y`: read off the page as it is laid out. */
function edgeGoneAt(leaf: Leaf, y: number): number {
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
function lineAtHeight(leaf: Leaf, y: number): number {
  const line = lineAt(page, leaf.shown, leaf.curled?.lean ?? 0);
  return line.top + ((line.bottom - line.top) * y) / 600;
}

/** A finger that came down at (380, `from`) and is at (`x`, `y`): the turn has gone half its way across. */
function dragged(leaf: Leaf, from: number, x: number, y: number): number {
  return follow(leaf, frame('held', [from, x, y]), (380 - x) / 800);
}

/** What the first of a finger's way is eased to, on a page 400 wide. */
const eased = (gone: number): number => (gone * gone) / (gone + 0.008 * 400);

describe('how a curled page keeps step with its turn', () => {
  it('carries its edge as far as the finger has gone, from the first of its way', () => {
    const leaf = sheet(0);
    // The first frame it is drawn in already shows what the finger has gone.
    dragged(leaf, 300, 360, 300);
    expect(edgeGoneAt(leaf, 300)).toBeCloseTo(eased(20), 0);
    for (const x of [374, 350, 300, 250, 180, 100, 40]) {
      dragged(leaf, 300, x, 300);
      expect(Math.abs(edgeGoneAt(leaf, 300) - eased(380 - x))).toBeLessThan(0.6);
    }
    // And back again by the way it came.
    dragged(leaf, 300, 350, 300);
    expect(Math.abs(edgeGoneAt(leaf, 300) - eased(30))).toBeLessThan(0.6);
    expect(dragged(leaf, 300, 380, 300)).toBe(0);
    expect(dragged(leaf, 300, 395, 300)).toBe(0);
  });

  it('does so wherever the finger goes, with the paper it holds lifted', () => {
    for (const [from, toX, toY] of [
      [560, 150, 330],
      [40, 150, 260],
      [300, 120, 80],
      [300, 150, 520],
      [570, 60, 570],
    ] as const) {
      const leaf = sheet(0);
      for (let step = 1; step <= 40; step += 1) {
        const x = 380 + ((toX - 380) * step) / 40;
        const y = from + ((toY - from) * step) / 40;
        dragged(leaf, from, x, y);
        expect(Math.abs(edgeGoneAt(leaf, y) - eased(380 - x))).toBeLessThan(1.5);
        // The line is this side of the page's edge at the finger's height.
        expect(lineAtHeight(leaf, y)).toBeLessThan(400);
      }
    }
  });

  it('lifts nothing for a finger that goes up or down only, and no great deal at a step', () => {
    const leaf = sheet(0);
    for (let y = 300; y >= 100; y -= 4) expect(dragged(leaf, 300, 380, y)).toBe(0);
    // Then across, a pixel at a time: the line never comes in by much at once.
    let last = 400;
    for (let x = 380; x >= 60; x -= 1) {
      dragged(leaf, 300, x, 100);
      const lead = 400 * (1 - leaf.shown);
      expect(last - lead).toBeLessThan(14);
      expect(last - lead).toBeGreaterThanOrEqual(0);
      last = lead;
    }
  });

  it('let go to turn, goes on from where it is no slower, is out of the frame while its turn still slows, and never steps back', () => {
    const leaf = sheet(0);
    dragged(leaf, 300, 220, 300);
    const held = leaf.shown;
    // The frame it is let go in shows it where it was.
    expect(follow(leaf, frame('landing', [300, 220, 300]), 0.2)).toBeCloseTo(held, 6);
    const edge = edgeGoneAt(leaf, 300);
    // Its edge goes on about as fast as the finger had it going: a little faster, to be gone in time.
    follow(leaf, frame('landing', [300, 220, 300]), 0.21);
    const pace = (edgeGoneAt(leaf, 300) - edge) / 8;
    expect(pace).toBeGreaterThan(0.99);
    expect(pace).toBeLessThan(1.3);
    let last = leaf.shown;
    for (let turned = 0.22; turned < 0.2 + 0.8 * GONE_BY - 0.005; turned += 0.01) {
      const now = follow(leaf, frame('landing', [300, 220, 300]), turned);
      expect(now).toBeGreaterThan(last);
      expect(now).toBeLessThan(1);
      last = now;
    }
    expect(follow(leaf, frame('landing', [300, 220, 300]), 0.2 + 0.8 * GONE_BY)).toBe(1);
    expect(follow(leaf, frame('landing', [300, 220, 300]), 0.95)).toBe(1);
  });

  it('let go to come back, comes back in step with its turn and lies flat when the turn has', () => {
    const leaf = sheet(0);
    dragged(leaf, 300, 260, 300);
    const held = leaf.shown;
    // The frame it is let go in shows it where it was.
    expect(follow(leaf, frame('returning', [300, 260, 300]), 0.15)).toBeCloseTo(held, 6);
    expect(follow(leaf, frame('returning', [300, 260, 300]), 0.075)).toBeCloseTo(held / 2, 6);
    let last = leaf.shown;
    for (let turned = 0.07; turned > 0.005; turned -= 0.01) {
      const now = follow(leaf, frame('returning', [300, 260, 300]), turned);
      expect(now).toBeLessThan(last);
      last = now;
    }
    expect(follow(leaf, frame('returning', [300, 260, 300]), 0)).toBe(0);
  });

  it('turned by a key, sweeps across upright and is gone before its turn stops', () => {
    const leaf = sheet(0);
    expect(follow(leaf, frame('landing'), 0)).toBe(0);
    let last = 0;
    for (let turned = 0.01; turned < GONE_BY; turned += 0.01) {
      const now = follow(leaf, frame('landing'), turned);
      expect(now).toBeGreaterThan(last);
      expect(leaf.curled?.lean).toBe(0);
      last = now;
    }
    expect(follow(leaf, frame('landing'), GONE_BY)).toBe(1);
  });

  it('goes on from where it is when what moves its turn changes', () => {
    const leaf = sheet(0);
    follow(leaf, frame('landing'), 0.02);
    const ahead = follow(leaf, frame('landing'), 0.4);
    // Sent back while still going on: it keeps going with its turn, then comes back with it.
    expect(follow(leaf, frame('returning'), 0.4)).toBeCloseTo(ahead, 6);
    expect(follow(leaf, frame('returning'), 0.44)).toBeGreaterThan(ahead);
    expect(follow(leaf, frame('returning'), 0.2)).toBeCloseTo(ahead / 2, 6);
    expect(follow(leaf, frame('returning'), 0)).toBe(0);
  });

  it('gone from the frame with its turn still on its way, stays gone until the turn has come back for it', () => {
    const leaf = sheet(0);
    follow(leaf, frame('landing'), 0.02);
    expect(follow(leaf, frame('landing'), 0.9)).toBe(1);
    // Sent back: the turn goes on a little, turns round, and the page comes in with it.
    expect(follow(leaf, frame('returning'), 0.9)).toBe(1);
    expect(follow(leaf, frame('returning'), 0.94)).toBe(1);
    expect(follow(leaf, frame('returning'), 0.45)).toBeCloseTo(0.5, 6);
    // Taken by a finger instead, it is as gone in the frame it is taken in.
    const taken = sheet(0);
    follow(taken, frame('landing'), 0.02);
    follow(taken, frame('landing'), 0.9);
    expect(follow(taken, frame('held', [300, 250, 300]), 0.9)).toBe(1);
  });

  it('taken in the air is where it was, whether or not it is lifted where the finger is', () => {
    for (const [shown, lean, y] of [
      [0.25, 0.5, 100],
      [0.02, 0.5, 300],
      [0.4, -0.3, 590],
      [0.6, 0, 300],
      [0.3, 0.3, 560],
      // Barely lifted: its edge still shows where it lay.
      [0.01, 0, 300],
    ] as const) {
      const leaf = sheet(shown, { ...curledFlat(), lean });
      const line = lineAt(page, shown, lean);
      // The finger has moved 9 px by the time it takes the page: none of that is the page's.
      const taken = follow(leaf, frame('held', [y + 9, 200, y]), 0.3);
      expect(taken).toBeCloseTo(shown, 5);
      expect(lineAt(page, taken, leaf.curled?.lean ?? 0).top).toBeCloseTo(line.top, 2);
      expect(lineAt(page, taken, leaf.curled?.lean ?? 0).bottom).toBeCloseTo(line.bottom, 2);
      // A hair's way on is a hair's difference; barely lifted, its line comes in as fast as it
      // does when a page first lifts, and no faster.
      const on = follow(leaf, frame('held', [y + 9, 199, y]), 0.3 + 1 / 800);
      expect(Math.abs(on - taken) * 400).toBeLessThan(shown < 0.02 ? 14 : 3);
      expect(on).toBeGreaterThanOrEqual(taken);
    }
  });

  it('leans by where a finger takes it and as the finger goes up or down, no more than lifts the paper it holds', () => {
    const leanOf = (down: number, x: number, to = down): number => {
      const leaf = sheet(0);
      dragged(leaf, down, x, to);
      return leaf.curled?.lean ?? Number.NaN;
    };
    // Taken by a corner it leans at once; half way up its edge it lifts upright.
    expect(leanOf(580, 350)).toBeGreaterThan(0.4);
    expect(leanOf(20, 350)).toBeLessThan(-0.4);
    expect(leanOf(300, 350)).toBe(0);
    // Nothing leans before the finger has gone anywhere.
    expect(leanOf(580, 380)).toBe(0);
    // The finger going up leans the line on, going down leans it back: the more the farther over the page is.
    expect(leanOf(300, 350, 180)).toBeGreaterThan(0);
    expect(leanOf(300, 350, 180)).toBeLessThan(0.08);
    expect(leanOf(300, 180, 180)).toBeCloseTo(0.25, 9);
    expect(leanOf(300, 180, 420)).toBeCloseTo(-0.25, 9);
    // A hair's difference in where it is taken is a hair's difference in how it leans.
    expect(Math.abs(leanOf(500, 300) - leanOf(503, 300))).toBeLessThan(0.02);
  });

  it("keeps the corner it is peeled from beside the finger that draws it along the page's edge", () => {
    const leaf = sheet(0);
    for (let x = 376; x >= 60; x -= 4) {
      dragged(leaf, 575, x, 575);
      const positions = laid(leaf.shown, leaf.curled?.lean ?? 0);
      const corner = seen(at(positions, COLUMNS - 1, ROWS - 1));
      // No higher than the finger, and no farther from it than when it was taken.
      expect(corner[1]).toBeGreaterThan(575 - 4);
      expect(Math.abs(corner[0] - (x + 20))).toBeLessThan(30);
    }
    // By then the line has stood nearly upright.
    expect(leaf.curled?.lean).toBeLessThan(0.15);
  });

  it('keeps its lean in the frame it is let go in', () => {
    const leaf = sheet(0);
    dragged(leaf, 560, 250, 400);
    const leant = leaf.curled?.lean ?? Number.NaN;
    expect(leant).toBeGreaterThan(0.2);
    follow(leaf, frame('landing', [560, 250, 400]), 130 / 800);
    expect(leaf.curled?.lean).toBeCloseTo(leant, 6);
  });

  it('brought back by a finger, keeps its line as far from the finger as it was', () => {
    const leaf = sheet(1);
    const back = (x: number, y = 300, phase: TransitionFrame['phase'] = 'held'): number => {
      const touch = { origin: { x: 30, y: 300 }, position: { x, y } };
      const turn = { ...forward(1 - (x - 30) / 800), forward: false };
      leaf.shown = wantedCurled(
        leaf,
        leaf.curled ?? curledFlat(),
        scene,
        { ...frame(phase), touch },
        turn,
      );
      return leaf.shown;
    };
    for (const x of [36, 60, 120, 200, 320]) {
      back(x);
      expect(lineAtHeight(leaf, 300)).toBeCloseTo(x - 30, 3);
    }
    // Up the page as it goes: still under the finger at the finger's height.
    back(320, 200);
    expect(lineAtHeight(leaf, 200)).toBeCloseTo(290, 3);
    // Let go, it goes on at that pace and lies flat with half its turn still to go.
    back(200);
    const held = leaf.shown;
    const landing = (turned: number): number => {
      const touch = { origin: { x: 30, y: 300 }, position: { x: 200, y: 300 } };
      const turn = { ...forward(turned), forward: false };
      leaf.shown = wantedCurled(
        leaf,
        leaf.curled ?? curledFlat(),
        scene,
        { ...frame('landing'), touch },
        turn,
      );
      return leaf.shown;
    };
    const from = 1 - 170 / 800;
    expect(landing(from)).toBeCloseTo(held, 6);
    landing(from - 0.01);
    expect(lineAtHeight(leaf, 300)).toBeCloseTo(178, 3);
    expect(landing(from - 0.2)).toBeGreaterThan(0);
    expect(landing(from - 230 / 800)).toBe(0);
    expect(landing(0.4)).toBe(0);
  });

  it('finishes by itself when its turn is at its end and it is not', () => {
    const leaf = sheet(0.5);
    // A finger let it go with the turn all but over: nothing is left to carry it there.
    const stays = follow(leaf, frame('landing', [300, 200, 300]), 0.995);
    expect(stays).toBe(0.5);
    expect(leaf.flight?.to).toBe(1);
    // And it is left to that until it is there: its own way is not begun again.
    fly(leaf, 0.05);
    const onItsWay = leaf.shown;
    expect(onItsWay).toBeGreaterThan(0.5);
    expect(follow(leaf, frame('landing', [300, 200, 300]), 1)).toBe(onItsWay);
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
