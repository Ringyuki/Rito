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
});
