import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FrameDriver } from '../src/driver/frame-driver';
import type { TransitionDriver } from '../src/driver/transition-driver';
import type { InteractionModeManager } from '../src/controller/interaction-mode/index';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import { wireUnifiedTouchHandler, type GestureDeps } from '../src/controller/wiring/gesture';
import { createDisposableCollection } from '../src/utils/disposable';
import {
  createDomTarget,
  createSelectionHarness,
  pointer,
  pointerPosition,
  touch,
  touchEvent,
} from './helpers/dom-input';

describe('pointer selection wiring', () => {
  it('routes only the active pointer and preserves single-click dispatch', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const click = vi.fn();
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      click,
    );

    dom.emit('pointerdown', pointer(1, 10, 20));
    dom.emit('pointerdown', pointer(2, 50, 60));
    dom.emit('pointermove', pointer(2, 51, 61));
    dom.emit('pointerup', pointer(2, 51, 61));

    expect(selection.down).toHaveBeenCalledTimes(1);
    expect(selection.move).not.toHaveBeenCalled();
    expect(selection.up).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    dom.emit('pointermove', pointer(1, 12, 22));
    dom.emit('pointerup', pointer(1, 11, 21));

    expect(selection.move).toHaveBeenCalledWith({ x: 12, y: 22 });
    expect(selection.up).toHaveBeenCalledWith({ x: 11, y: 21 });
    expect(click).toHaveBeenCalledWith({ x: 11, y: 21 });

    dom.emit('pointerdown', pointer(2, 30, 40));
    expect(selection.down).toHaveBeenCalledTimes(2);
    dom.emit('pointerup', pointer(2, 40, 50));
    dispose();
  });

  it('cancels only the active pointer without pointer-up or click dispatch', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const click = vi.fn();
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      click,
    );

    dom.emit('pointerdown', pointer(7, 10, 20));
    dom.emit('pointercancel', pointer(8, 10, 20));
    expect(selection.clear).not.toHaveBeenCalled();

    dom.emit('pointercancel', pointer(7, 10, 20));
    dom.emit('lostpointercapture', pointer(7, 10, 20));
    dom.emit('pointerup', pointer(7, 10, 20));

    expect(selection.clear).toHaveBeenCalledTimes(1);
    expect(selection.up).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    dom.emit('pointerdown', pointer(9, 10, 20));
    dom.emit('lostpointercapture', pointer(9, 10, 20));
    dom.emit('pointerup', pointer(9, 10, 20));
    expect(selection.clear).toHaveBeenCalledTimes(2);
    expect(selection.up).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();

    dom.emit('pointerdown', pointer(10, 10, 20, 'touch'));
    expect(selection.down).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('discards an active pointer when the binding is disposed', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const click = vi.fn();
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      click,
    );

    dom.emit('pointerdown', pointer(1, 10, 20));
    dispose();
    dom.emit('pointerup', pointer(1, 10, 20));

    expect(selection.clear).toHaveBeenCalledTimes(1);
    expect(selection.up).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it('silently cancels when pointer capture cannot be established', () => {
    const dom = createDomTarget();
    const canvas = dom.target as HTMLCanvasElement;
    canvas.setPointerCapture = vi.fn(() => {
      throw new Error('capture unavailable');
    });
    const selection = createSelectionHarness();
    const click = vi.fn();
    const dispose = bindPointerEvents(canvas, selection.engine, pointerPosition, click);

    expect(() => {
      dom.emit('pointerdown', pointer(1, 10, 20));
    }).not.toThrow();
    dom.emit('pointerup', pointer(1, 10, 20));

    expect(selection.down).toHaveBeenCalledTimes(1);
    expect(selection.clear).toHaveBeenCalledTimes(1);
    expect(selection.up).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    dispose();
  });
});

describe('touch selection wiring', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks the original touch identity through long-press selection', () => {
    vi.useFakeTimers();
    const harness = createTouchHarness();
    const first = touch(1, 10, 20);
    const second = touch(2, 70, 80);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    harness.dom.emit('touchstart', touchEvent([first, second], [second]));
    vi.advanceTimersByTime(350);

    expect(harness.selection.down).toHaveBeenCalledTimes(1);
    expect(harness.selection.down).toHaveBeenCalledWith({ x: 10, y: 20 });

    const movedFirst = touch(1, 30, 40);
    const movedSecond = touch(2, 90, 100);
    harness.dom.emit('touchmove', touchEvent([first, movedSecond], [movedSecond]));
    expect(harness.selection.move).not.toHaveBeenCalled();

    harness.dom.emit('touchmove', touchEvent([movedSecond, movedFirst], [movedFirst]));
    expect(harness.selection.move).toHaveBeenCalledWith({ x: 30, y: 40 });

    harness.dom.emit('touchend', touchEvent([movedFirst], [movedSecond]));
    expect(harness.selection.up).not.toHaveBeenCalled();

    harness.dom.emit('touchend', touchEvent([], [movedFirst]));
    expect(harness.selection.up).toHaveBeenCalledWith({ x: 30, y: 40 });
    expect(harness.tap).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });

  it('touchcancel clears a pending timer and never turns it into a tap or selection', () => {
    vi.useFakeTimers();
    const harness = createTouchHarness();
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    harness.dom.emit('touchcancel', touchEvent([], [first]));
    vi.advanceTimersByTime(1_000);
    harness.dom.emit('touchend', touchEvent([], [first]));

    expect(harness.selection.down).not.toHaveBeenCalled();
    expect(harness.selection.up).not.toHaveBeenCalled();
    expect(harness.selection.clear).not.toHaveBeenCalled();
    expect(harness.tap).not.toHaveBeenCalled();

    const next = touch(2, 15, 25);
    harness.dom.emit('touchstart', touchEvent([next], [next]));
    harness.dom.emit('touchend', touchEvent([], [next]));
    expect(harness.selection.clear).toHaveBeenCalledTimes(1);
    expect(harness.tap).toHaveBeenCalledWith({ x: 15, y: 25 });
    harness.disposables.disposeAll();
  });

  it('touchcancel discards an active long-press selection without pointer-up or tap', () => {
    vi.useFakeTimers();
    const harness = createTouchHarness();
    const first = touch(1, 10, 20);
    const other = touch(2, 80, 90);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    harness.dom.emit('touchmove', touchEvent([other, touch(1, 30, 40)], [touch(1, 30, 40)]));
    harness.dom.emit('touchcancel', touchEvent([first], [other]));
    expect(harness.selection.clear).not.toHaveBeenCalled();

    harness.dom.emit('touchcancel', touchEvent([], [first]));
    harness.dom.emit('touchend', touchEvent([], [first]));

    expect(harness.selection.clear).toHaveBeenCalledTimes(1);
    expect(harness.selection.up).not.toHaveBeenCalled();
    expect(harness.tap).not.toHaveBeenCalled();
    expect(harness.setMode).toHaveBeenLastCalledWith('gesture');
    harness.disposables.disposeAll();
  });

  it('touchcancel cancels page tracking without committing the gesture', () => {
    const harness = createTouchHarness();
    const first = touch(1, 50, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    harness.dom.emit('touchmove', touchEvent([touch(1, 20, 20)], [touch(1, 20, 20)], 10));
    harness.dom.emit('touchcancel', touchEvent([], [touch(1, 20, 20)]));

    expect(harness.cancelTracking).toHaveBeenCalledTimes(1);
    expect(harness.releaseTracking).not.toHaveBeenCalled();
    expect(harness.selection.down).not.toHaveBeenCalled();
    expect(harness.selection.up).not.toHaveBeenCalled();
    expect(harness.tap).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });
});

function createTouchHarness() {
  const dom = createDomTarget();
  const selection = createSelectionHarness();
  const tap = vi.fn();
  const setMode = vi.fn();
  const cancelTracking = vi.fn(() => true);
  const cancelGestureNavigation = vi.fn();
  const releaseTracking = vi.fn();
  const scheduleComposite = vi.fn();
  const forceSettle = vi.fn(() => 0);
  const td = {
    isAnimating: false,
    cancelTracking,
    releaseTracking,
    startTracking: vi.fn(),
    updateTracking: vi.fn(),
    interrupt: vi.fn(),
    forceSettle,
    onSettled: vi.fn(() => () => {}),
  } as unknown as TransitionDriver;
  const frameDriver = { scheduleComposite } as unknown as FrameDriver;
  const deps: GestureDeps = {
    td,
    frameDriver,
    startGestureNavigation: (_index: number, onTransitionStart: () => void) => {
      onTransitionStart();
      return { cancel: cancelGestureNavigation };
    },
    getCurrentSpread: () => 0,
    getTotalSpreads: () => 3,
    isPaginationComplete: () => true,
    commitPendingTransition: vi.fn(),
  };
  const modeManager = {
    mode: 'gesture',
    setMode,
    onModeChange: () => () => {},
  } as InteractionModeManager;
  const disposables = createDisposableCollection();
  wireUnifiedTouchHandler(
    dom.target,
    deps,
    selection.engine,
    modeManager,
    (value) => ({ x: value.clientX, y: value.clientY }),
    tap,
    disposables,
  );
  return {
    dom,
    selection,
    tap,
    setMode,
    cancelTracking,
    cancelGestureNavigation,
    releaseTracking,
    scheduleComposite,
    disposables,
  };
}
