import { describe, expect, it } from 'vitest';
import { springPresets } from '../src/driver/effects';
import { springAt, stepSpring, type SpringState } from '../src/driver/spring';
import samples from './fixtures/spring-samples.json';

describe('stepSpring', () => {
  it('converges from displaced position to target', () => {
    const state: SpringState = { x: 100, vx: 0 };
    let steps = 0;
    while (!stepSpring(state, 0, springPresets.default, 16) && steps < 500) {
      steps++;
    }
    expect(state.x).toBe(0);
    expect(state.vx).toBe(0);
    expect(steps).toBeLessThan(200);
  });

  it('converges with initial velocity', () => {
    const state: SpringState = { x: 0, vx: 2 };
    let steps = 0;
    while (!stepSpring(state, 0, springPresets.default, 16) && steps < 500) {
      steps++;
    }
    expect(state.x).toBe(0);
    expect(steps).toBeLessThan(200);
  });

  it('settles faster with higher damping (overdamped)', () => {
    const underdamped: SpringState = { x: 100, vx: 0 };
    const overdamped: SpringState = { x: 100, vx: 0 };

    let stepsUnder = 0;
    while (!stepSpring(underdamped, 0, { stiffness: 180, damping: 10 }, 16) && stepsUnder < 500) {
      stepsUnder++;
    }

    let stepsOver = 0;
    while (!stepSpring(overdamped, 0, { stiffness: 180, damping: 40 }, 16) && stepsOver < 500) {
      stepsOver++;
    }

    // Both converge
    expect(underdamped.x).toBe(0);
    expect(overdamped.x).toBe(0);
  });

  it('can target non-zero values', () => {
    const state: SpringState = { x: 0, vx: 0 };
    let steps = 0;
    while (!stepSpring(state, 500, springPresets.default, 16) && steps < 500) {
      steps++;
    }
    expect(state.x).toBe(500);
  });

  it('returns true immediately when already at target', () => {
    const state: SpringState = { x: 0, vx: 0 };
    const settled = stepSpring(state, 0, springPresets.default, 16);
    expect(settled).toBe(true);
  });

  it.each([300, 800, 1120, 1600])(
    'settles a %ipx programmatic turn within a perceptible duration',
    (viewportWidth) => {
      const state: SpringState = { x: 0, vx: 0 };
      let elapsedMs = 0;
      while (!stepSpring(state, -viewportWidth, springPresets.default, 16) && elapsedMs < 1_000) {
        elapsedMs += 16;
      }

      // The spring runs until what motion remains is sub-pixel — 600-750ms
      // for the critically damped default, most of it the eased landing.
      // A coarser cut (4px/300px/s, settling in ~350ms) ended every page
      // turn with a visible snap.
      expect(elapsedMs).toBeGreaterThanOrEqual(600);
      expect(elapsedMs).toBeLessThanOrEqual(1000);
      expect(state).toEqual({ x: -viewportWidth, vx: 0 });
    },
  );
});

describe('springAt', () => {
  const springs = {
    underdamped: { stiffness: 180, damping: 10 },
    critical: { stiffness: 180, damping: 2 * Math.sqrt(180) },
    overdamped: { stiffness: 180, damping: 40 },
  };

  it.each(Object.entries(springs))('solves the %s oscillator exactly', (_, spring) => {
    const start = springAt(spring, 700, -1500, 0);
    expect(start.offset).toBeCloseTo(700, 9);
    expect(start.velocity).toBeCloseTo(-1500, 6);
    // x'' + c·x' + k·x = 0, checked by finite differences along the curve.
    const h = 1e-4;
    for (const t of [0.03, 0.2, 0.6]) {
      const a = springAt(spring, 700, -1500, t - h);
      const b = springAt(spring, 700, -1500, t);
      const c = springAt(spring, 700, -1500, t + h);
      const acceleration = (c.offset - 2 * b.offset + a.offset) / (h * h);
      const residual = acceleration + spring.damping * b.velocity + spring.stiffness * b.offset;
      expect(Math.abs(residual)).toBeLessThan(1e-2 * spring.stiffness);
      expect(b.velocity).toBeCloseTo((c.offset - a.offset) / (2 * h), 2);
    }
  });

  it('traces the same turn whatever the frame rate', () => {
    const at = (frameMs: number) => {
      const state: SpringState = { x: -60, vx: -900 };
      for (let t = 0; t < 300; t += frameMs)
        stepSpring(state, -800, springPresets.default, frameMs);
      return state.x;
    };
    const reference = at(1);
    for (const frameMs of [6, 7.5, 10, 12, 15, 20, 30])
      expect(at(frameMs)).toBeCloseTo(reference, 6);
  });

  it('matches the sample table rito_flutter checks itself against', () => {
    for (const entry of samples.cases) {
      const spring =
        'preset' in entry
          ? springPresets[entry.preset as keyof typeof springPresets]
          : entry.spring;
      for (const sample of entry.samples) {
        const value = springAt(spring, entry.offset, entry.velocity, sample.t);
        expect(value.offset).toBeCloseTo(sample.offset, 9);
        expect(value.velocity).toBeCloseTo(sample.velocity, 9);
      }
    }
  });

  it('never carries a preset past its target, however hard it is flicked', () => {
    for (const spring of Object.values(springPresets)) {
      for (const velocity of [0, -800, -3000, -20_000]) {
        const state: SpringState = { x: -120, vx: velocity };
        let lowest = 0;
        for (let i = 0; i < 300 && !stepSpring(state, -800, spring, 8); i++) {
          lowest = Math.min(lowest, state.x);
        }
        expect(lowest).toBeGreaterThanOrEqual(-800);
      }
    }
  });
});
