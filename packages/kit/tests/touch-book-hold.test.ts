import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearTouchTimer,
  createTouchHandlerContext,
  type GestureDeps,
} from '../src/controller/wiring/touch-context';
import { scheduleLongPressSelection } from '../src/controller/wiring/touch-selection';
import { createSelectionHarness, touch } from './helpers/dom-input';

afterEach(() => {
  vi.useRealTimers();
});

describe('the whole-book layout while a press waits to become a long press', () => {
  it('is held from the press until the selection the long press starts holds it', () => {
    vi.useFakeTimers();
    const fixture = pressFixture();
    scheduleLongPressSelection(fixture.context);
    expect(fixture.events).toEqual(['hold']);

    vi.advanceTimersByTime(350);

    // The selection starts before the press lets the book go.
    expect(fixture.events).toEqual(['hold', 'select', 'release']);
  });

  it('is let go when the press ends as a tap', () => {
    vi.useFakeTimers();
    const fixture = pressFixture();
    scheduleLongPressSelection(fixture.context);

    clearTouchTimer(fixture.context.state);
    vi.advanceTimersByTime(350);

    expect(fixture.events).toEqual(['hold', 'release']);
  });
});

function pressFixture() {
  const events: string[] = [];
  const selection = createSelectionHarness();
  selection.down.mockImplementation(() => {
    events.push('select');
  });
  const deps = {
    holdBookLayout: () => {
      events.push('hold');
      return () => {
        events.push('release');
      };
    },
  } as unknown as GestureDeps;
  const context = createTouchHandlerContext(
    deps,
    selection.engine,
    { mode: 'gesture', setMode: vi.fn(), onModeChange: () => () => {} },
    (value) => ({ x: value.clientX, y: value.clientY }),
    vi.fn(),
    undefined,
  );
  context.state.phase = 'waiting';
  context.state.activeTouchId = 1;
  context.state.selectionStart = touch(1, 10, 20);
  return { context, events };
}
