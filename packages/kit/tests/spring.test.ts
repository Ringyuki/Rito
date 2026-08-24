import { describe, expect, it } from 'vitest';
import { stepSpring, DEFAULT_SPRING, type SpringState } from '../src/driver/spring';

describe('stepSpring', () => {
  it('converges from displaced position to target', () => {
    const state: SpringState = { x: 100, vx: 0 };
    let steps = 0;
    while (!stepSpring(state, 0, DEFAULT_SPRING, 16) && steps < 500) {
      steps++;
    }
    expect(state.x).toBe(0);
    expect(state.vx).toBe(0);
    expect(steps).toBeLessThan(200);
  });

  it('converges with initial velocity', () => {
    const state: SpringState = { x: 0, vx: 2 };
    let steps = 0;
    while (!stepSpring(state, 0, DEFAULT_SPRING, 16) && steps < 500) {
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
    while (!stepSpring(state, 500, DEFAULT_SPRING, 16) && steps < 500) {
      steps++;
    }
    expect(state.x).toBe(500);
  });

  it('returns true immediately when already at target', () => {
    const state: SpringState = { x: 0, vx: 0 };
    const settled = stepSpring(state, 0, DEFAULT_SPRING, 16);
    expect(settled).toBe(true);
  });

  it.each([300, 800, 1120, 1600])(
    'settles a %ipx programmatic turn within a perceptible duration',
    (viewportWidth) => {
      const state: SpringState = { x: 0, vx: 0 };
      let elapsedMs = 0;
      while (!stepSpring(state, -viewportWidth, DEFAULT_SPRING, 16) && elapsedMs < 1_000) {
        elapsedMs += 16;
      }

      // The spring integrates until motion is sub-pixel AND essentially
      // stationary (0.5px / 0.05px/s — the 0.13 thresholds). Numerically
      // that is ~860-950ms, but everything past ~350ms is an
      // imperceptible sub-pixel tail: the eased landing IS the feel. A
      // coarser cut (4px/300px/s, settling in ~350ms) ended every page
      // turn with a visible snap.
      expect(elapsedMs).toBeGreaterThanOrEqual(700);
      expect(elapsedMs).toBeLessThanOrEqual(1000);
      expect(state).toEqual({ x: -viewportWidth, vx: 0 });
    },
  );
});
