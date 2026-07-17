import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTouchHandlerContext } from '../src/controller/wiring/touch-context';
import { scheduleLongPressSelection } from '../src/controller/wiring/touch-selection';
import type {
  PrimarySelectionDragNavigation,
  PrimarySelectionDragSession,
} from '../src/controller/wiring/selection-drag';
import { createSelectionHarness, touch } from './helpers/dom-input';

afterEach(() => {
  vi.useRealTimers();
});

describe('selection physical input intent', () => {
  it('does not let a delayed long press reclaim ownership from newer navigation', () => {
    vi.useFakeTimers();
    let ownsInput = true;
    const input = { owns: () => ownsInput };
    const rejected: PrimarySelectionDragSession = {
      update() {},
      finish: () => false,
      cancel: () => false,
      owns: () => false,
      wasSuperseded: () => true,
      didNavigate: () => false,
    };
    const begin = vi.fn<PrimarySelectionDragNavigation['begin']>((candidate, start) => {
      if (candidate.owns()) start();
      return rejected;
    });
    const navigation: PrimarySelectionDragNavigation = {
      claim: () => input,
      begin,
    };
    const selection = createSelectionHarness();
    const setMode = vi.fn();
    const context = createTouchHandlerContext(
      {} as never,
      selection.engine,
      { mode: 'gesture', setMode, onModeChange: () => () => {} },
      (value) => ({ x: value.clientX, y: value.clientY }),
      vi.fn(),
      navigation,
    );
    context.state.phase = 'waiting';
    context.state.activeTouchId = 1;
    context.state.selectionStart = touch(1, 10, 20);
    context.state.selectionInput = input;
    scheduleLongPressSelection(context);

    ownsInput = false;
    vi.advanceTimersByTime(350);

    expect(begin).not.toHaveBeenCalled();
    expect(selection.down).not.toHaveBeenCalled();
    expect(setMode).not.toHaveBeenCalled();
    expect(context.state.phase).toBe('idle');
  });
});
