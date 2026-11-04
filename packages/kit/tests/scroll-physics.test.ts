import { describe, expect, it } from 'vitest';
import { defaultScrollPhysics as physics } from '../src/scroll/physics';

/** Runs a simulation in 16 ms steps until it rests; its offsets. */
function run(simulation: ReturnType<typeof physics.release>): number[] {
  const offsets: number[] = [];
  for (let frame = 1; frame < 2_000; frame += 1) {
    const at = simulation(frame * 0.016);
    offsets.push(at.offset);
    if (at.done) return offsets;
  }
  throw new Error('the motion never rests');
}

describe('default scroll physics', () => {
  it('follows a drag inside the book and resists past its ends', () => {
    expect(physics.drag(500, 10_000, 950)).toBe(500);
    const pulled = physics.drag(-300, 10_000, 950);
    expect(pulled).toBeLessThan(0);
    expect(pulled).toBeGreaterThan(-300);
    const pushed = physics.drag(10_300, 10_000, 950) - 10_000;
    expect(pushed).toBeCloseTo(-pulled);
  });

  it('glides after a fling, slowing, and rests', () => {
    const offsets = run(physics.release(1_000, 3_000, 100_000));
    offsets.reduce((before, offset) => {
      expect(offset).toBeGreaterThan(before);
      return offset;
    }, 1_000);
    // It glides velocity / friction at most.
    const last = offsets.at(-1) ?? 0;
    expect(last).toBeLessThan(1_000 + 3_000 / 2);
    expect(last).toBeGreaterThan(1_000 + 3_000 / 2 - 10);
  });

  it('springs back to the end it was pulled past, and to the end a fling reaches', () => {
    const back = run(physics.release(-120, 0, 10_000));
    expect(back.at(-1)).toBe(0);
    const flung = run(physics.release(9_900, 3_000, 10_000));
    expect(flung.at(-1)).toBe(10_000);
    expect(Math.max(...flung)).toBeGreaterThan(10_000);
  });
});
