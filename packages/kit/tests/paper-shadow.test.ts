import { describe, expect, it } from 'vitest';
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
