import { describe, expect, it } from 'vitest';
import { rubberBand } from '../src/driver/rubber-band';

describe('rubberBand', () => {
  const W = 800;

  it('returns 0 for dx=0', () => {
    expect(rubberBand(0, W)).toBe(0);
  });

  it('is approximately linear for small displacements', () => {
    const small = rubberBand(10, W);
    // For small dx relative to W, output ≈ dx * coefficient
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(10);
  });

  it('asymptotically approaches W * coefficient', () => {
    const large = rubberBand(100000, W);
    const limit = W * 0.55;
    expect(large).toBeGreaterThan(limit * 0.95);
    expect(large).toBeLessThanOrEqual(limit);
  });

  it('is sign-symmetric', () => {
    const pos = rubberBand(200, W);
    const neg = rubberBand(-200, W);
    expect(pos).toBeCloseTo(-neg, 10);
  });

  it('has expected values at key points', () => {
    // dx = W/2 → ~0.18 * W
    const half = rubberBand(W / 2, W);
    expect(half).toBeGreaterThan(W * 0.15);
    expect(half).toBeLessThan(W * 0.22);

    // dx = 2*W → ~0.37 * W
    const double = rubberBand(2 * W, W);
    expect(double).toBeGreaterThan(W * 0.33);
    expect(double).toBeLessThan(W * 0.41);
  });
});
