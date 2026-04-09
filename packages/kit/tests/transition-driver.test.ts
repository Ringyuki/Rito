import { describe, expect, it, vi } from 'vitest';
import { createTransitionDriver } from '../src/driver/transition-driver';

describe('TransitionDriver', () => {
  function createDriver(
    opts?: { swipeThreshold?: number; velocityCommit?: number },
    viewportWidth = 800,
  ) {
    const driver = createTransitionDriver(opts);
    driver.viewportWidth = viewportWidth;
    return driver;
  }

  it('starts idle', () => {
    const td = createDriver();
    expect(td.mode.kind).toBe('idle');
    expect(td.isAnimating).toBe(false);
  });

  it('idle step returns single instruction', () => {
    const td = createDriver();
    const instr = td.step(16);
    expect(instr.kind).toBe('single');
    if (instr.kind === 'single') expect(instr.slot).toBe('curr');
  });

  it('startTracking transitions to tracking', () => {
    const td = createDriver();
    td.startTracking('forward', 0, 1, 0);
    expect(td.mode.kind).toBe('tracking');
    expect(td.isAnimating).toBe(true);
  });

  it('updateTracking updates dx and vx', () => {
    const td = createDriver();
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-100, 100);
    expect(td.mode.kind).toBe('tracking');
    if (td.mode.kind === 'tracking') {
      expect(td.mode.dx).toBe(-100);
      expect(td.mode.vx).not.toBe(0);
    }
  });

  it('step during tracking returns turning instruction with current dx', () => {
    const td = createDriver();
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-200, 100);
    const instr = td.step(16);
    expect(instr.kind).toBe('turning');
    if (instr.kind === 'turning') {
      expect(instr.dx).toBe(-200);
      expect(instr.outgoing).toBe('curr');
      expect(instr.incoming).toBe('next');
    }
  });

  it('releaseTracking commits when dx exceeds threshold', () => {
    const td = createDriver({ swipeThreshold: 50 });
    td.viewportWidth = 800;
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-100, 100); // > 50px threshold
    const result = td.releaseTracking();
    expect(result).toBe('commit');
    expect(td.mode.kind).toBe('settling');
    if (td.mode.kind === 'settling') {
      expect(td.mode.target).toBe(-800);
    }
  });

  it('releaseTracking cancels when dx below threshold', () => {
    const td = createDriver({ swipeThreshold: 50 });
    td.viewportWidth = 800;
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-20, 100); // < 50px threshold, low velocity
    const result = td.releaseTracking();
    expect(result).toBe('cancel');
    expect(td.mode.kind).toBe('settling');
    if (td.mode.kind === 'settling') {
      expect(td.mode.target).toBe(0);
    }
  });

  it('releaseTracking commits on high velocity even if dx < threshold (fling)', () => {
    const td = createDriver({ swipeThreshold: 100, velocityCommit: 0.4 });
    td.startTracking('forward', 0, 1, 0);
    // Simulate fast fling: 5 samples accelerating rapidly
    td.updateTracking(-5, 10);
    td.updateTracking(-15, 20);
    td.updateTracking(-30, 30);
    td.updateTracking(-50, 40);
    td.updateTracking(-80, 50); // ~3 px/ms → well above 0.4 threshold
    const result = td.releaseTracking();
    expect(result).toBe('commit');
  });

  it('releaseTracking commits via projection: small dx + moderate velocity', () => {
    const td = createDriver({ swipeThreshold: 50, velocityCommit: 2.0 }); // high vCommit to isolate projection
    td.startTracking('forward', 0, 1, 0);
    // dx = -30 < threshold, but vx ≈ -0.5 px/ms → projected = |-30 + -0.5*150| = 105 > 50
    td.updateTracking(-10, 50);
    td.updateTracking(-20, 100);
    td.updateTracking(-30, 150);
    const result = td.releaseTracking();
    expect(result).toBe('commit');
  });

  it('releaseTracking cancels when both dx and projection are below threshold', () => {
    const td = createDriver({ swipeThreshold: 50, velocityCommit: 2.0 });
    td.startTracking('forward', 0, 1, 0);
    // Slow, small drag: dx = -10, vx ≈ -0.05 → projected = |-10 + -0.05*150| = 17.5 < 50
    td.updateTracking(-5, 100);
    td.updateTracking(-8, 200);
    td.updateTracking(-10, 300);
    const result = td.releaseTracking();
    expect(result).toBe('cancel');
  });

  it('goToTarget goes directly to settling', () => {
    const td = createDriver();
    td.goToTarget('forward', 0, 1);
    expect(td.mode.kind).toBe('settling');
    if (td.mode.kind === 'settling') {
      expect(td.mode.dx).toBe(0);
      expect(td.mode.target).toBe(-800);
    }
  });

  it('goToTarget backward sets positive target', () => {
    const td = createDriver();
    td.goToTarget('backward', 1, 0);
    expect(td.mode.kind).toBe('settling');
    if (td.mode.kind === 'settling') {
      expect(td.mode.target).toBe(800);
    }
  });

  it('settling converges to target and emits onSettled', () => {
    const td = createDriver();
    const onSettled = vi.fn();
    td.onSettled(onSettled);

    td.goToTarget('forward', 0, 1);
    let steps = 0;
    while (td.isAnimating && steps < 500) {
      td.step(16);
      steps++;
    }

    expect(td.mode.kind).toBe('idle');
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0]?.[0]).toMatchObject({
      direction: 'forward',
      committed: true,
      targetSpread: 1,
    });
  });

  it('interrupt during settling returns dx/vx and resumes tracking', () => {
    const td = createDriver();
    td.goToTarget('forward', 0, 1);
    // Step a few frames to build up some dx
    td.step(16);
    td.step(16);

    const state = td.interrupt(1000);
    expect(state).not.toBeNull();
    expect(td.mode.kind).toBe('tracking');
  });

  it('interrupt during non-settling returns null', () => {
    const td = createDriver();
    expect(td.interrupt(0)).toBeNull();
  });

  it('boundary elastic: incoming=null triggers rubber band release', () => {
    const td = createDriver();
    td.startTracking('forward', 0, null, 0); // null = at boundary
    td.updateTracking(-100, 100);
    const result = td.releaseTracking();
    expect(result).toBe('cancel');
    expect(td.mode.kind).toBe('boundary-elastic');
  });

  it('boundary elastic settles back to 0', () => {
    const td = createDriver();
    const onSettled = vi.fn();
    td.onSettled(onSettled);

    td.startTracking('forward', 0, null, 0);
    td.updateTracking(-100, 100);
    td.releaseTracking();

    let steps = 0;
    while (td.isAnimating && steps < 500) {
      td.step(16);
      steps++;
    }

    expect(td.mode.kind).toBe('idle');
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ committed: false }));
  });

  it('reset forces idle', () => {
    const td = createDriver();
    td.goToTarget('forward', 0, 1);
    expect(td.isAnimating).toBe(true);
    td.reset();
    expect(td.mode.kind).toBe('idle');
    expect(td.isAnimating).toBe(false);
  });

  it('onSettled unsubscribe works', () => {
    const td = createDriver();
    const cb = vi.fn();
    const unsub = td.onSettled(cb);
    unsub();

    td.goToTarget('forward', 0, 1);
    while (td.isAnimating) td.step(16);

    expect(cb).not.toHaveBeenCalled();
  });
});
