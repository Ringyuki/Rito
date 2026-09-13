import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import type { PrimarySelectionDragNavigation } from '../src/controller/wiring/selection-drag';
import {
  createDomTarget,
  createSelectionHarness,
  pointer,
  pointerPosition,
  touch,
  touchEvent,
} from './helpers/dom-input';
import {
  primarySelectionDragSession,
  primarySelectionNavigation,
} from './helpers/primary-selection';
import { createTouchSelectionHarness } from './helpers/touch-selection';

afterEach(() => {
  vi.useRealTimers();
});

describe('selection physical input ownership', () => {
  it('does not dispatch an unmanaged click after pointer-up reenters newer navigation', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    let ownsInput = true;
    const input = { owns: () => ownsInput };
    const navigation = unmanagedNavigation(input);
    selection.up.mockImplementation(() => {
      ownsInput = false;
    });
    const click = vi.fn();
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      click,
      navigation,
    );

    dom.emit('pointerdown', pointer(1, 10, 20));
    dom.emit('pointerup', pointer(1, 10, 20));

    expect(selection.up).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    dispose();
  });

  it('does not let a superseded unmanaged pointer mutate or clear replacement selection', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    let ownsInput = true;
    const input = { owns: () => ownsInput };
    const click = vi.fn();
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      click,
      unmanagedNavigation(input),
    );

    dom.emit('pointerdown', pointer(1, 10, 20));
    ownsInput = false;
    dom.emit('pointermove', pointer(1, 30, 40));
    dom.emit('pointerup', pointer(1, 30, 40));

    expect(selection.move).not.toHaveBeenCalled();
    expect(selection.up).not.toHaveBeenCalled();
    expect(selection.clear).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    dispose();
  });

  it('keeps an animating touch settlement-only when selection claim settles the transition', () => {
    vi.useFakeTimers();
    let isAnimating = true;
    const navigation = primarySelectionNavigation(primarySelectionDragSession());
    navigation.claim.mockImplementation(() => {
      isAnimating = false;
      return { owns: () => true };
    });
    const harness = createTouchSelectionHarness(
      navigation,
      (value) => ({ x: value.clientX, y: value.clientY }),
      () => isAnimating,
    );
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    harness.dom.emit('touchend', touchEvent([], [first]));

    expect(navigation.claim).toHaveBeenCalledOnce();
    expect(navigation.begin).not.toHaveBeenCalled();
    expect(harness.selection.down).not.toHaveBeenCalled();
    expect(harness.selection.clear).not.toHaveBeenCalled();
    expect(harness.tap).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });

  it('keeps a superseded waiting touch from reclaiming navigation after crossing slop', () => {
    vi.useFakeTimers();
    let ownsInput = true;
    const navigation = primarySelectionNavigation(primarySelectionDragSession());
    navigation.claim.mockReturnValue({ owns: () => ownsInput });
    const harness = createTouchSelectionHarness(navigation);
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    ownsInput = false;
    const moved = touch(1, 30, 20);
    harness.dom.emit('touchmove', touchEvent([moved], [moved], 10));
    harness.dom.emit('touchend', touchEvent([], [moved]));

    expect(harness.startGestureNavigation).not.toHaveBeenCalled();
    expect(harness.selection.down).not.toHaveBeenCalled();
    expect(harness.selection.clear).not.toHaveBeenCalled();
    expect(harness.tap).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });

  it('does not dispatch a tap when selection clear synchronously starts newer navigation', () => {
    let ownsInput = true;
    const navigation = primarySelectionNavigation(primarySelectionDragSession());
    navigation.claim.mockReturnValue({ owns: () => ownsInput });
    const harness = createTouchSelectionHarness(navigation);
    harness.selection.clear.mockImplementation(() => {
      ownsInput = false;
    });
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    harness.dom.emit('touchend', touchEvent([], [first]));

    expect(harness.selection.clear).toHaveBeenCalledOnce();
    expect(harness.tap).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });
});

function unmanagedNavigation(input: {
  readonly owns: () => boolean;
}): PrimarySelectionDragNavigation {
  return {
    claim: () => input,
    begin: (_candidate, start) => {
      start();
      return null;
    },
  };
}
