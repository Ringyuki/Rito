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

  it('says where the finger had carried the turn farthest, from before the turn could begin', () => {
    const scenario = createScenario(false);
    beginSwipe(scenario, 250, 100);
    // Out 150, and back to 60 while the neighbour is still being painted: the turn takes no samples yet.
    const back = touch(1, 190, 20);
    scenario.dom.emit('touchmove', touchEvent([back], [back], 15));
    expect(scenario.td.mode.kind).toBe('idle');
    scenario.markContentReady();
    const finger = { origin: { x: 250, y: 20 }, position: { x: 190, y: 20 } };
    expect(scenario.td.mode).toMatchObject({
      kind: 'tracking',
      touch: { ...finger, farthest: { x: 100, y: 20 } },
    });
    // Farther the way the turn goes moves it on; the other way, however far, does not.
    const on = touch(1, 60, 30);
    scenario.dom.emit('touchmove', touchEvent([on], [on], 20));
    expect(scenario.td.mode).toMatchObject({ touch: { farthest: { x: 60, y: 30 } } });
    const past = touch(1, 460, 40);
    scenario.dom.emit('touchmove', touchEvent([past], [past], 25));
    expect(scenario.td.mode).toMatchObject({
      touch: { position: { x: 460, y: 40 }, farthest: { x: 60, y: 30 } },
    });
    cancelSwipe(scenario, past, 30);
    settle(scenario.td);
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

describe('cutting into a turn in flight', () => {
  type Scenario = ReturnType<typeof createScenario>;
  const W = 300;
  const ends = (scenario: Scenario): string[] =>
    scenario.transitionEnd.mock.calls.map(([event]) => (event as { outcome: string }).outcome);
  const dxOf = (scenario: Scenario): number => (scenario.td.mode as { dx: number }).dx;
  const vxOf = (scenario: Scenario): number => (scenario.td.mode as { vx: number }).vx;
  /** A turn to spread 1 by key, some of the way there. */
  const inFlight = (scenario: Scenario): { dx: number; vx: number } => {
    scenario.nav.goToSpread(1);
    for (let step = 0; step < 6; step += 1) scenario.td.step(16);
    return { dx: dxOf(scenario), vx: vxOf(scenario) };
  };
  /** A finger down at `fromX` and across to `toX`, still down. */
  const swipe = (scenario: Scenario, fromX: number, toX: number, at = 1000): Touch => {
    const start = touch(1, fromX, 20);
    const moved = touch(1, toX, 20);
    scenario.dom.emit('touchstart', touchEvent([start], [start], at));
    scenario.dom.emit('touchmove', touchEvent([moved], [moved], at + 10));
    return moved;
  };

  it('a second turn by key takes the picture on from where it is, as fast', () => {
    const scenario = createScenario(true, 4);
    const before = inFlight(scenario);

    scenario.nav.goToSpread(2);

    // The turn in flight has landed, once, and the next one is the same picture still moving.
    expect(scenario.poolHarness.rotateForward).toHaveBeenCalledOnce();
    expect(ends(scenario)).toEqual(['committed']);
    expect(scenario.td.mode).toMatchObject({ kind: 'settling', direction: 'forward', target: -W });
    expect(dxOf(scenario)).toBeCloseTo(before.dx + W, 6);
    expect(vxOf(scenario)).toBeCloseTo(before.vx, 6);

    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(2);
    expect(ends(scenario)).toEqual(['committed', 'committed']);
    expect(scenario.transitionStart).toHaveBeenCalledTimes(2);
    scenario.disposables.disposeAll();
  });

  it('a turn back by key turns the same page round', () => {
    const scenario = createScenario(true, 4);
    const before = inFlight(scenario);

    scenario.nav.goToSpread(0);

    expect(scenario.td.mode).toMatchObject({ kind: 'settling', direction: 'backward', target: W });
    expect(dxOf(scenario)).toBeCloseTo(before.dx + W, 6);
    expect(vxOf(scenario)).toBeCloseTo(before.vx, 6);
    // The page never leaves the stretch between the two spreads.
    for (let step = 0; step < 500 && scenario.td.turning; step += 1) {
      expect(dxOf(scenario)).toBeGreaterThanOrEqual(0);
      expect(dxOf(scenario)).toBeLessThanOrEqual(W);
      scenario.td.step(16);
    }
    expect(scenario.internals.currentSpread).toBe(0);
    expect(ends(scenario)).toEqual(['committed', 'committed']);
    scenario.disposables.disposeAll();
  });

  it('a step taken while a turn is going back is one spread, not two', () => {
    const scenario = createScenario(true, 4);
    cancelSwipe(scenario, beginSwipe(scenario, 200, 100), 20);
    scenario.td.step(16);
    // The reader is still on spread 1 by name, on its way back to 0.
    expect(scenario.internals.currentSpread).toBe(1);

    scenario.nav.nextSpread();

    expect(scenario.internals.currentSpread).toBe(1);
    expect(scenario.poolHarness.slots).toMatchObject({ curr: 0, next: 1 });
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(1);
    expect(ends(scenario)).toEqual(['cancelled', 'committed']);
    scenario.disposables.disposeAll();
  });

  it('a swipe during a turn going back turns from the spread it went back to', () => {
    const scenario = createScenario(true, 4);
    cancelSwipe(scenario, beginSwipe(scenario, 200, 100), 20);
    scenario.td.step(16);
    const returning = dxOf(scenario);

    const moved = swipe(scenario, 200, 150);

    // From 0 to 1 again: the same page, taken where it was on its way back.
    expect(scenario.td.mode).toMatchObject({
      kind: 'tracking',
      direction: 'forward',
      outgoingSpread: 0,
      incomingSpread: 1,
    });
    expect(dxOf(scenario)).toBeCloseTo(returning - 50, 6);
    expect(scenario.internals.currentSpread).toBe(1);
    expect(scenario.poolHarness.slots).toMatchObject({ curr: 0, next: 1 });

    endSwipe(scenario, moved, 1020);
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(1);
    expect(ends(scenario)).toEqual(['cancelled', 'committed']);
    scenario.disposables.disposeAll();
  });

  it('keeps moving while the turn that cut in waits for its page', () => {
    const scenario = createScenario(true, 4);
    scenario.holdContent(2);
    const before = inFlight(scenario);

    scenario.nav.goToSpread(2);

    // Nothing has begun: the turn that was cut into carries on by itself.
    expect(scenario.td.turning).toBe(false);
    expect(scenario.transitionStart).toHaveBeenCalledOnce();
    expect(dxOf(scenario)).toBeCloseTo(before.dx + W, 6);
    scenario.td.step(16);
    scenario.td.step(16);
    const moved = dxOf(scenario);
    expect(moved).toBeLessThan(before.dx + W);

    scenario.markContentReady(2);
    expect(scenario.td.mode).toMatchObject({ kind: 'settling', direction: 'forward', target: -W });
    expect(dxOf(scenario)).toBeCloseTo(moved, 6);
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(2);
    expect(ends(scenario)).toEqual(['committed', 'committed']);
    scenario.disposables.disposeAll();
  });

  it('a finger that only comes down leaves the turn alone', () => {
    const scenario = createScenario(true, 4);
    inFlight(scenario);
    const mode = scenario.td.mode;
    const down = touch(1, 200, 20);

    scenario.dom.emit('touchstart', touchEvent([down], [down], 1000));
    scenario.dom.emit('touchend', touchEvent([], [down], 1050));

    expect(scenario.td.mode).toBe(mode);
    expect(ends(scenario)).toEqual([]);
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(1);
    scenario.disposables.disposeAll();
  });

  it('a swipe on takes the picture where it is, and a flick lands two spreads on', () => {
    const scenario = createScenario(true, 4);
    const before = inFlight(scenario);

    const moved = swipe(scenario, 200, 150);

    expect(ends(scenario)).toEqual(['committed']);
    expect(scenario.internals.currentSpread).toBe(2);
    expect(scenario.td.mode).toMatchObject({ kind: 'tracking', direction: 'forward' });
    // What was left of the first turn, and the finger's 50 px on top of it.
    expect(dxOf(scenario)).toBeCloseTo(before.dx + W - 50, 6);
    expect(dxOf(scenario)).toBeGreaterThan(0);

    endSwipe(scenario, moved, 1020);
    expect(scenario.td.mode).toMatchObject({ kind: 'settling', target: -W });
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(2);
    expect(ends(scenario)).toEqual(['committed', 'committed']);
    scenario.disposables.disposeAll();
  });

  it('a swipe back takes the same page back to the spread it left', () => {
    const scenario = createScenario(true, 4);
    const before = inFlight(scenario);

    const moved = swipe(scenario, 100, 150);

    expect(scenario.internals.currentSpread).toBe(0);
    expect(scenario.td.mode).toMatchObject({ kind: 'tracking', direction: 'backward' });
    expect(dxOf(scenario)).toBeCloseTo(before.dx + W + 50, 6);

    endSwipe(scenario, moved, 1020);
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(0);
    expect(ends(scenario)).toEqual(['committed', 'committed']);
    scenario.disposables.disposeAll();
  });

  it('a pull against the end of the book takes the picture too, and lands the turn once', () => {
    const scenario = createScenario();
    const before = inFlight(scenario);

    const moved = swipe(scenario, 200, 150);

    expect(scenario.poolHarness.rotateForward).toHaveBeenCalledOnce();
    expect(ends(scenario)).toEqual(['committed']);
    expect(scenario.td.mode).toMatchObject({ kind: 'tracking', incomingSpread: null });
    // The pull is resisted; what was left of the turn is not.
    const pulled = dxOf(scenario) - (before.dx + W);
    expect(pulled).toBeLessThan(0);
    expect(pulled).toBeGreaterThan(-50);

    endSwipe(scenario, moved, 1020);
    settle(scenario.td);
    expect(scenario.internals.currentSpread).toBe(1);
    expect(ends(scenario)).toEqual(['committed']);
    expect(scenario.transitionStart).toHaveBeenCalledOnce();
    scenario.disposables.disposeAll();
  });

  it('a swipe taken away goes back to the spread the turn had just landed on', () => {
    const scenario = createScenario(true, 4);
    inFlight(scenario);

    cancelSwipe(scenario, swipe(scenario, 200, 150), 1020);
    settle(scenario.td);

    expect(scenario.internals.currentSpread).toBe(1);
    expect(ends(scenario)).toEqual(['committed', 'cancelled']);
    scenario.disposables.disposeAll();
  });

  it('a finger pulling against the end of the book retires a turn still waiting for its page', () => {
    const scenario = createScenario();
    inFlight(scenario);
    scenario.holdContent(0);
    scenario.nav.goToSpread(0);
    expect(scenario.td.turning).toBe(false);

    swipe(scenario, 200, 150);
    scenario.markContentReady(0);

    // The turn back never begins under the finger.
    expect(scenario.td.mode).toMatchObject({ kind: 'tracking', incomingSpread: null });
    expect(scenario.internals.currentSpread).toBe(1);
    scenario.disposables.disposeAll();
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
      const scenario = createScenario(true, 4);
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
    scenario.nav.nextSpread();
    scenario.td.step(16);
    scenario.nav.nextSpread();
  });
  run('turn-back-during-turn', (scenario) => {
    scenario.nav.nextSpread();
    scenario.td.step(16);
    scenario.nav.prevSpread();
  });
  // A finger takes the page a turn is carrying, and flicks it on.
  run('finger-during-turn', (scenario) => {
    scenario.nav.nextSpread();
    scenario.td.step(16);
    endSwipe(scenario, beginSwipe(scenario, 300, 240), 20);
  });
  // A finger that comes down and lifts without moving leaves the turn be.
  run('finger-rests-during-turn', (scenario) => {
    scenario.nav.nextSpread();
    scenario.td.step(16);
    const down = touch(1, 300, 20);
    scenario.dom.emit('touchstart', touchEvent([down], [down], 0));
    scenario.dom.emit('touchend', touchEvent([], [down], 30));
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
