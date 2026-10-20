import { describe, expect, it } from 'vitest';
import { touch, touchEvent } from './helpers/dom-input';
import {
  createTouchNavigationScenario as createScenario,
  settleTransition,
} from './helpers/touch-navigation';

describe('a finger sliding up or down the page', () => {
  it('neither turns it nor taps', () => {
    const scenario = createScenario();
    const start = touch(1, 200, 100);
    scenario.dom.emit('touchstart', touchEvent([start], [start], 0));
    const up = touch(1, 196, 90);
    scenario.dom.emit('touchmove', touchEvent([up], [up], 10));
    const further = touch(1, 193, 40);
    scenario.dom.emit('touchmove', touchEvent([further], [further], 20));
    scenario.dom.emit('touchend', touchEvent([], [further], 30));
    expect(scenario.td.mode.kind).toBe('idle');
    expect(scenario.transitionStart).not.toHaveBeenCalled();
    expect(scenario.internals.currentSpread).toBe(0);
    scenario.disposables.disposeAll();
  });

  it('turns it from where it goes the way pages turn', () => {
    const scenario = createScenario();
    const start = touch(1, 200, 100);
    scenario.dom.emit('touchstart', touchEvent([start], [start], 0));
    const up = touch(1, 198, 60);
    scenario.dom.emit('touchmove', touchEvent([up], [up], 10));
    expect(scenario.td.mode.kind).toBe('idle');
    // Then across: the turn takes the finger from where it went across.
    const across = touch(1, 188, 58);
    scenario.dom.emit('touchmove', touchEvent([across], [across], 20));
    expect(scenario.td.mode).toMatchObject({ kind: 'tracking', direction: 'forward', dx: -10 });
    scenario.dom.emit('touchend', touchEvent([], [across], 30));
    settleTransition(scenario.td);
    expect(scenario.internals.currentSpread).toBe(1);
    scenario.disposables.disposeAll();
  });

  it('drifting a little across as it slides does not turn it', () => {
    const scenario = createScenario();
    const start = touch(1, 200, 300);
    scenario.dom.emit('touchstart', touchEvent([start], [start], 0));
    let last = start;
    for (let i = 1; i <= 10; i += 1) {
      last = touch(1, 200 - 3 * i, 300 - 30 * i);
      scenario.dom.emit('touchmove', touchEvent([last], [last], 10 * i));
    }
    scenario.dom.emit('touchend', touchEvent([], [last], 110));
    settleTransition(scenario.td);
    expect(scenario.transitionStart).not.toHaveBeenCalled();
    expect(scenario.internals.currentSpread).toBe(0);
    scenario.disposables.disposeAll();
  });

  it('turns it at once when it leaves the slop the way pages turn', () => {
    const scenario = createScenario();
    const start = touch(1, 200, 100);
    scenario.dom.emit('touchstart', touchEvent([start], [start], 0));
    const across = touch(1, 192, 104);
    scenario.dom.emit('touchmove', touchEvent([across], [across], 10));
    expect(scenario.td.mode.kind).toBe('tracking');
    scenario.disposables.disposeAll();
  });
});
