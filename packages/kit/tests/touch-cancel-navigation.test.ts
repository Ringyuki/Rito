import { describe, expect, it } from 'vitest';
import { touch, touchEvent } from './helpers/dom-input';
import {
  beginSwipe,
  cancelSwipe,
  createTouchNavigationScenario as createScenario,
  endSwipe,
  settleTransition as settle,
} from './helpers/touch-navigation';
import lifecycle from './fixtures/turn-lifecycle.json';

describe('touch navigation lifecycle', () => {
  it('settles a canceled swipe back to its outgoing spread', () => {
    const scenario = createScenario();
    const moved = beginSwipe(scenario, 200, 100);

    expect(scenario.internals.currentSpread).toBe(1);
    expect(scenario.poolHarness.slots).toEqual({ prev: null, curr: 0, next: 1 });
    expect(scenario.td.mode.kind).toBe('tracking');

    cancelSwipe(scenario, moved, 20);
    expect(scenario.td.mode).toMatchObject({ kind: 'settling', target: 0 });
    settle(scenario.td);

    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.poolHarness.slots.curr).toBe(0);
    expect(scenario.poolHarness.rotateForward).not.toHaveBeenCalled();
    expect(scenario.poolHarness.rotateBackward).not.toHaveBeenCalled();
    expect(scenario.notifyActiveSpread).toHaveBeenNthCalledWith(1, 1);
    expect(scenario.notifyActiveSpread).toHaveBeenNthCalledWith(2, 0);
    expect(scenario.transitionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'forward' }),
    );
    scenario.disposables.disposeAll();
  });

  it('does not emit stale canceled-transition events after notification redirects', () => {
    const scenario = createScenario();
    const moved = beginSwipe(scenario, 200, 100);
    cancelSwipe(scenario, moved, 20);
    scenario.spreadChange.mockClear();
    const lifecycle: string[] = [];
    scenario.transitionStart.mockImplementation(() => {
      lifecycle.push('start');
    });
    scenario.transitionEnd.mockImplementation(() => {
      lifecycle.push('end');
    });
    scenario.notifyActiveSpread.mockImplementation((spreadIndex: number) => {
      if (spreadIndex === 0) scenario.nav.goToSpread(1);
    });

    scenario.td.forceSettle();

    expect(scenario.internals.currentSpread).toBe(1);
    expect(scenario.spreadChange).toHaveBeenCalledOnce();
    expect(scenario.spreadChange).toHaveBeenCalledWith(expect.objectContaining({ spreadIndex: 1 }));
    // The cancelled swipe ends (interrupted) before the redirected turn
    // starts: every start gets exactly one end, and none arrives late.
    expect(lifecycle).toEqual(['end', 'start']);
    expect(scenario.transitionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'interrupted' }),
    );
    expect(scenario.td.isAnimating).toBe(true);

    settle(scenario.td);
    expect(lifecycle).toEqual(['end', 'start', 'end']);
    scenario.disposables.disposeAll();
  });

  it('balances the canceled transition lifecycle when notification redirects by snap', () => {
    const scenario = createScenario();
    const moved = beginSwipe(scenario, 200, 100);
    cancelSwipe(scenario, moved, 20);
    scenario.notifyActiveSpread.mockImplementation((spreadIndex: number) => {
      if (spreadIndex === 0) scenario.nav.jumpToSpread(1);
    });

    scenario.td.forceSettle();

    expect(scenario.internals.currentSpread).toBe(1);
    expect(scenario.td.isAnimating).toBe(false);
    expect(scenario.transitionStart).toHaveBeenCalledOnce();
    expect(scenario.transitionEnd).toHaveBeenCalledOnce();
    expect(scenario.transitionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'forward' }),
    );
    scenario.disposables.disposeAll();
  });

  it('commits a ready swipe on touchend and rotates the page pool', () => {
    const scenario = createScenario();
    const moved = beginSwipe(scenario, 250, 50);

    endSwipe(scenario, moved, 20);
    expect(scenario.td.mode).toMatchObject({ kind: 'settling', target: -300 });
    settle(scenario.td);

    expect(scenario.internals.currentSpread).toBe(1);
    expect(scenario.poolHarness.slots.curr).toBe(1);
    expect(scenario.poolHarness.rotateForward).toHaveBeenCalledTimes(1);
    expect(scenario.poolHarness.rotateBackward).not.toHaveBeenCalled();
    scenario.disposables.disposeAll();
  });

  it('adopts the latest drag sample when deferred content becomes ready, then cancels safely', () => {
    const scenario = createScenario(false);
    beginSwipe(scenario, 200, 170);
    const latest = touch(1, 110, 20);
    scenario.dom.emit('touchmove', touchEvent([latest], [latest], 15));

    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.td.mode.kind).toBe('idle');
    scenario.markContentReady();

    expect(scenario.internals.currentSpread).toBe(1);
    expect(scenario.td.mode).toMatchObject({ kind: 'tracking', dx: -90 });
    cancelSwipe(scenario, latest, 20);
    expect(scenario.td.mode).toMatchObject({ kind: 'settling', target: 0 });
    settle(scenario.td);

    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.poolHarness.slots.curr).toBe(0);
    scenario.disposables.disposeAll();
  });

  it('does not revive a deferred swipe after touchcancel', () => {
    const scenario = createScenario(false);
    const moved = beginSwipe(scenario, 200, 100);

    cancelSwipe(scenario, moved, 20);
    scenario.markContentReady();

    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.td.mode.kind).toBe('idle');
    expect(scenario.transitionStart).not.toHaveBeenCalled();
    expect(scenario.notifyActiveSpread).not.toHaveBeenCalled();
    scenario.disposables.disposeAll();
  });

  it('replays the final touchend sample when deferred content becomes ready', () => {
    const scenario = createScenario(false);
    beginSwipe(scenario, 200, 170);
    const ended = touch(1, 50, 20);
    endSwipe(scenario, ended, 30);

    expect(scenario.td.mode.kind).toBe('idle');
    scenario.markContentReady();

    expect(scenario.td.mode).toMatchObject({ kind: 'settling', target: -300 });
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(1);
    expect(scenario.poolHarness.slots.curr).toBe(1);
    expect(scenario.poolHarness.rotateForward).toHaveBeenCalledTimes(1);
    scenario.disposables.disposeAll();
  });

  it('cancels an active deferred swipe during disposal', () => {
    const scenario = createScenario(false);
    beginSwipe(scenario, 200, 100);

    scenario.disposables.disposeAll();
    scenario.markContentReady();

    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.td.mode.kind).toBe('idle');
    expect(scenario.transitionStart).not.toHaveBeenCalled();
  });

  it('cancels an ended deferred swipe during disposal', () => {
    const scenario = createScenario(false);
    const moved = beginSwipe(scenario, 200, 50);
    endSwipe(scenario, moved, 20);

    scenario.disposables.disposeAll();
    scenario.markContentReady();

    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.td.mode.kind).toBe('idle');
    expect(scenario.transitionStart).not.toHaveBeenCalled();
  });

  it('force-settles an owned canceled transition during disposal', () => {
    const scenario = createScenario();
    const moved = beginSwipe(scenario, 200, 100);
    cancelSwipe(scenario, moved, 20);
    expect(scenario.td.mode).toMatchObject({ kind: 'settling', target: 0 });

    scenario.disposables.disposeAll();

    expect(scenario.td.mode.kind).toBe('idle');
    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.poolHarness.slots.curr).toBe(0);
    expect(scenario.poolHarness.rotateForward).not.toHaveBeenCalled();
    expect(scenario.transitionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'forward' }),
    );
  });

  it('cancels and force-settles an actively tracked swipe during disposal', () => {
    const scenario = createScenario();
    beginSwipe(scenario, 200, 100);
    expect(scenario.td.mode.kind).toBe('tracking');

    scenario.disposables.disposeAll();

    expect(scenario.td.mode.kind).toBe('idle');
    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.poolHarness.slots.curr).toBe(0);
  });

  it('does not settle an unrelated programmatic transition during disposal', () => {
    const scenario = createScenario();
    scenario.nav.goToSpread(1);
    expect(scenario.td.mode).toMatchObject({ kind: 'settling', target: -300 });

    scenario.disposables.disposeAll();

    expect(scenario.td.mode).toMatchObject({ kind: 'settling', target: -300 });
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(1);
  });
});

// The outcomes rito_flutter reports for the same scenarios: both suites
// read fixtures/turn-lifecycle.json.
describe('how a turn ends, as on every host', () => {
  type Scenario = ReturnType<typeof createScenario>;
  const ends = (scenario: Scenario): string[] =>
    scenario.transitionEnd.mock.calls.map(([event]) => (event as { outcome: string }).outcome);
  const run = (name: keyof typeof lifecycle.ends, drive: (scenario: Scenario) => void): void => {
    it(name, () => {
      const scenario = createScenario();
      drive(scenario);
      settle(scenario.td);
      expect(ends(scenario)).toEqual(lifecycle.ends[name]);
      expect(scenario.transitionStart).toHaveBeenCalledTimes(lifecycle.ends[name].length);
      scenario.disposables.disposeAll();
    });
  };

  run('turn-lands', (scenario) => {
    scenario.nav.goToSpread(1);
  });
  run('drag-goes-back', (scenario) => {
    cancelSwipe(scenario, beginSwipe(scenario, 200, 100), 20);
  });
  run('turn-during-turn', (scenario) => {
    scenario.nav.goToSpread(1);
    scenario.td.step(16);
    scenario.nav.goToSpread(0);
  });
  run('jump-during-turn', (scenario) => {
    scenario.nav.goToSpread(1);
    scenario.td.step(16);
    scenario.nav.jumpToSpread(0);
    expect(scenario.internals.currentSpread).toBe(0);
  });
  run('jump-during-drag', (scenario) => {
    beginSwipe(scenario, 200, 100);
    scenario.nav.jumpToSpread(1);
    expect(scenario.internals.currentSpread).toBe(1);
  });
});
