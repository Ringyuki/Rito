import { describe, expect, it } from 'vitest';
import { layCurl, curlThrough, lineAt } from '../src/driver/paper/curl';
import { edgeGone, gotTo, leantBy, shownFor, stillShort } from '../src/driver/paper/curl-hold';
import type { CurlLine } from '../src/driver/paper/curl';
import type { LeafShape } from '../src/driver/paper/leaf';

const viewOf = (shape: LeafShape) => ({
  width: shape.width,
  height: shape.height,
  eye: 2.4 * Math.max(shape.width, shape.height),
});

/** How far the free edge shows from where it lies flat at the height `y`, read off the page as it is laid out. */
function edgeOnTheMesh(shape: LeafShape, shown: number, lean: number, y: number): number | null {
  const columns = 2;
  const rows = 1201;
  const positions = new Float32Array(columns * rows * 3);
  layCurl(
    shape,
    curlThrough(shape, lineAt(shape, shown, lean)),
    columns,
    rows,
    positions,
    positions.slice(),
  );
  const view = viewOf(shape);
  const seen = (row: number): [number, number] => {
    const p = (row * columns + 1) * 3;
    const k = view.eye / (view.eye - (positions[p + 2] ?? 0));
    return [
      view.width / 2 + ((positions[p] ?? 0) - view.width / 2) * k,
      view.height / 2 + ((positions[p + 1] ?? 0) - view.height / 2) * k,
    ];
  };
  for (let row = 1; row < rows; row += 1) {
    const before = seen(row - 1);
    const here = seen(row);
    if (before[1] <= y && here[1] >= y) {
      const share = (y - before[1]) / (here[1] - before[1] || 1);
      return shape.width - (before[0] + (here[0] - before[0]) * share);
    }
  }
  // The edge does not show at that height: its end has been carried past it.
  return null;
}

/** How far in from the page's edge the line is at the height `y`. */
function lineIn(shape: LeafShape, line: CurlLine, y: number): number {
  return shape.spine + shape.width - (line.top + ((line.bottom - line.top) * y) / shape.height);
}

describe('how far over a curled page is for where its edge is wanted', () => {
  const phone = { spine: 0, width: 393, height: 760 };

  it('puts the edge where it is asked for, at any height and lean the paper can take', () => {
    const view = viewOf(phone);
    let checked = 0;
    for (const y of [40, 200, 380, 600, 730]) {
      for (const to of [0.5, 3, 12, 40, 61, 62, 90, 180, 300, 500]) {
        for (const wanted of [-0.7, -0.2, 0, 0.2, 0.7]) {
          const lean = leantBy(phone, wanted, to, y, 0);
          const shown = shownFor(phone, to, lean, y, view);
          const read = edgeOnTheMesh(phone, shown, lean, y);
          if (read === null) throw new Error(`no edge at ${String(y)} for ${String(to)}`);
          // Where the edge shows is worked out again from how high it stands until it settles.
          expect(Math.abs(read - to)).toBeLessThan(0.1);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(250);
  });

  it('is in one place only for what is asked of it, with any lean a held page is given', () => {
    const tablet = { spine: 0, width: 768, height: 1024 };
    const wide = { spine: 0, width: 1280, height: 720 };
    for (const shape of [phone, tablet, wide]) {
      const view = viewOf(shape);
      for (const y of [0, shape.height * 0.3, shape.height * 0.6, shape.height * 0.97]) {
        for (const share of [0.01, 0.1, 0.4, 0.9, 1.5, 1.9]) {
          for (const wanted of [-3, -0.3, 0, 0.3, 3]) {
            const to = share * shape.width;
            const lean = leantBy(shape, wanted, to, y, 0);
            // Short of it everywhere before, and at or past it everywhere after.
            let crossed = 0;
            let before = gotTo(shape, 0, lean, y, view) >= to;
            for (let shown = 0.0025; shown <= 1.0001; shown += 0.0025) {
              const past = gotTo(shape, shown, lean, y, view) >= to;
              if (past !== before) crossed += 1;
              before = past;
            }
            expect(crossed).toBe(1);
            const shown = shownFor(shape, to, lean, y, view);
            expect(gotTo(shape, shown, lean, y, view)).toBeCloseTo(to, 3);
          }
        }
      }
    }
    // On a page taller than wide it comes in one way only, with any lean at all: one kept
    // from when it was taken, and all the way from turned for a page brought back.
    for (const lean of [-0.8, -0.4, 0, 0.4, 0.8]) {
      for (const y of [0, 230, 680]) {
        let last = -Infinity;
        for (let shown = 0; shown <= 1.0001; shown += 0.0025) {
          const got = gotTo(phone, shown, lean, y, viewOf(phone));
          expect(got).toBeGreaterThanOrEqual(last);
          last = got;
        }
      }
    }
  });

  it('carries the edge through where the paper has yet to lift, without a step', () => {
    const view = viewOf(phone);
    // A corner peel: at mid height the line is still beyond the page's edge.
    const line = lineAt(phone, 0.1, 0.5);
    expect(lineIn(phone, line, 300)).toBeLessThan(0);
    const there = edgeGone(phone, line, 300, view);
    expect(there).toBeLessThan(0);
    // Asked to be a little farther on, the page is a little farther over, and so on until it lifts there.
    expect(shownFor(phone, there, 0.5, 300, view)).toBeCloseTo(0.1, 6);
    let last = 0.1;
    // No step: the line comes in by no more than a share of the roll's radius for each unit.
    const radius = 0.13 * phone.width;
    for (let more = 1; more <= 620; more += 1) {
      const shown = shownFor(phone, there + more, 0.5, 300, view);
      expect(shown).toBeGreaterThanOrEqual(last);
      expect((shown - last) * phone.width).toBeLessThan(0.4 * radius);
      last = shown;
    }
    // By the time the edge is asked to have gone somewhere, the paper has lifted there.
    expect(there + 620).toBeGreaterThan(0);
    expect(lineIn(phone, lineAt(phone, last, 0.5), 300)).toBeGreaterThan(0);
  });

  it('lies flat short of anything asked of it, and is turned past all its edge can go', () => {
    const view = viewOf(phone);
    expect(shownFor(phone, 0, 0, 380, view)).toBe(0);
    expect(shownFor(phone, 2 * 393, 0.3, 380, view)).toBe(1);
    // Turned, its edge has gone twice the page's width: where a page brought back begins.
    expect(gotTo(phone, 1, 0, 380, view)).toBeCloseTo(2 * 393, 6);
  });
});

describe('how a page comes to the finger that has set off with it', () => {
  it('is off from rest, nine tenths of the way in a tenth of a second, and never turns round', () => {
    expect(stillShort(0)).toBe(1);
    // A frame on it has hardly moved: at a sixtieth of a second an eighth of the way, where
    // an approach that slows from the start would have taken a third.
    expect(1 - stillShort(1 / 60)).toBeLessThan(0.14);
    expect(1 - stillShort(1 / 120)).toBeLessThan(0.04);
    expect(stillShort(0.11)).toBeLessThan(0.1);
    expect(stillShort(0.1)).toBeGreaterThan(0.1);
    expect(stillShort(0.25)).toBeLessThan(0.001);
    let last = 1;
    for (let seconds = 0.004; seconds < 0.4; seconds += 0.004) {
      const now = stillShort(seconds);
      expect(now).toBeLessThan(last);
      // No more than a quarter of the way in any frame of a sixtieth.
      expect(stillShort(seconds) - stillShort(seconds + 1 / 60)).toBeLessThan(0.25);
      last = now;
    }
  });
});

describe('how much a held page leans', () => {
  const phone = { spine: 0, width: 393, height: 760 };

  it('not at all before its edge has gone anywhere, unless it leant when it was taken', () => {
    expect(leantBy(phone, 0.6, 0, 700, 0)).toBe(0);
    expect(leantBy(phone, -0.6, 0, 60, 0)).toBe(-0);
    expect(leantBy(phone, 0.6, 0, 300, 0.45)).toBe(0.45);
    expect(leantBy(phone, -0.6, -40, 300, -0.3)).toBe(-0.3);
  });

  it('by a corner at once, half way up the edge only as the page comes over', () => {
    // 40 from the bottom corner: free to lean after as much again of the edge's way.
    expect(leantBy(phone, 0.55, 30, 720, 0)).toBeCloseTo(0.55, 9);
    // Half way up: the paper there lifts first.
    expect(leantBy(phone, 0.55, 30, 380, 0)).toBeCloseTo(30 / 380, 9);
    expect(leantBy(phone, 0.55, 300, 380, 0)).toBeCloseTo(0.55, 9);
    // The other way it is the upper corner that leads, and the distance to that one that counts.
    expect(leantBy(phone, -0.55, 30, 380, 0)).toBeCloseTo(-30 / 380, 9);
    expect(leantBy(phone, -0.55, 30, 40, 0)).toBeCloseTo(-0.55, 9);
  });

  it('so that the paper at the finger is lifted and the corner it is peeled from is no higher than the finger', () => {
    const view = viewOf(phone);
    for (const y of [100, 380, 600, 720, 755]) {
      for (let gone = 2; gone <= 600; gone += 7) {
        const lean = leantBy(phone, 0.8, gone, y, 0);
        const shown = shownFor(phone, gone, lean, y, view);
        const line = lineAt(phone, shown, lean);
        expect(lineIn(phone, line, y)).toBeGreaterThan(0);
        // The edge that shows at the finger's height is the page's own, not past its corner:
        // but for a finger nearer the corner than it counts as being.
        if (phone.height - y >= 0.05 * phone.width) {
          expect(edgeOnTheMesh(phone, shown, lean, y)).not.toBeNull();
        } else {
          expect(gone * lean).toBeLessThanOrEqual(0.05 * phone.width + 1e-9);
        }
      }
    }
  });

  it('never past what a page wider than it is tall can be laid out by', () => {
    const wide = { spine: 0, width: 1280, height: 720 };
    for (let gone = 1; gone < 2400; gone += 13) {
      expect(Math.abs(leantBy(wide, 3, gone, 700, 0))).toBeLessThanOrEqual(0.8);
      expect(Math.abs(leantBy(wide, -3, gone, 20, 0))).toBeLessThanOrEqual(0.8);
    }
  });
});
