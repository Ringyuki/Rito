import type { PaperTurnCurl } from '@ritojs/core';
import { describe, expect, it } from 'vitest';
import { hidesFrom } from '../src/driver/paper/shadow';
import { sidesOf } from '../src/driver/paper/shadow-targets';

describe('where the spine parts what a shadow is worked out in', () => {
  it('parts two pages at the edge between the texels either side of the spine', () => {
    // A frame 2560 wide worked out 1280 texels wide: the spine is the edge after texel 639.
    const sides = sidesOf(1280, 2560, 1280);
    expect(sides.spine).toBe(0.5);
    expect(sides.edge).toBe(0.5);
    expect(sides.left * 1280).toBeCloseTo(639.5);
    expect(sides.right * 1280).toBeCloseTo(640.5);
  });

  it('gives a texel the spine runs through the middle of to one page only', () => {
    // 2558 wide worked out 1279 texels wide: the spine is the middle of texel 639.
    const sides = sidesOf(1279, 2558, 1279);
    expect(sides.spine).toBe(0.5);
    // It is the left page's, and what is read for the right page comes no nearer than the next.
    expect(sides.edge * 1279).toBeCloseTo(640);
    expect(sides.left * 1279).toBeCloseTo(639.5);
    expect(sides.right * 1279).toBeCloseTo(640.5);
  });

  it('leaves the whole width to the one page of a spread', () => {
    const sides = sidesOf(0, 1179, 590);
    expect(sides.edge).toBe(0);
    expect(sides.right * 590).toBeCloseTo(0.5);
    expect(sides.left).toBeLessThan(0);
  });
});

describe('what of a sheet hides the pages from the eye', () => {
  const page = { width: 400, height: 600 };
  /** A page curled over through the line from `top` on its top edge to `bottom` on its bottom edge. */
  const curlThrough = (line: { top: number; bottom: number }): PaperTurnCurl => {
    const across = line.top - line.bottom;
    const length = Math.hypot(page.height, across);
    const dx = page.height / length;
    return { dx, dy: across / length, at: line.top * dx, radius: 40 };
  };
  /** Whether the cover counts a point of the sheet, as its shader does. */
  const hides = (from: readonly [number, number, number], x: number, y: number): boolean =>
    x * from[0] + y * from[1] - from[2] > 0;

  it('is, of a page curled over, its paper from the line it leaves the pages at', () => {
    // Leaning either way, and upright.
    for (const line of [
      { top: 300, bottom: 180 },
      { top: 240, bottom: 240 },
      { top: 180, bottom: 300 },
    ]) {
      const from = hidesFrom(curlThrough(line));
      for (const [x, y] of [
        [line.top, 0],
        [line.bottom, page.height],
        [(line.top + line.bottom) / 2, page.height / 2],
      ] as const) {
        // However little the paper has risen just past the line, it is over the page beneath.
        expect(hides(from, x + 0.01, y)).toBe(true);
        // A point on the line itself is never taken for a point in sight.
        expect(hides(from, x, y)).toBe(true);
        // What still lies on the pages is where the shadow falls.
        expect(hides(from, x - 2, y)).toBe(false);
      }
    }
  });

  it('is all of a leaf', () => {
    const from = hidesFrom(null);
    expect(hides(from, 0, 0)).toBe(true);
    expect(hides(from, 400, 600)).toBe(true);
  });
});
