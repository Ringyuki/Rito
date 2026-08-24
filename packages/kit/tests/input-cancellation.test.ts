import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import type {
  PrimarySelectionDragNavigation,
  PrimarySelectionDragSession,
} from '../src/controller/wiring/selection-drag';
import {
  createDomTarget,
  createSelectionHarness,
  mouseDown,
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

describe('pointer selection wiring', () => {
  it('feeds client-space edge input and suppresses click after a physical selection turn', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const click = vi.fn();
    const edge = primarySelectionDragSession(true);
    const navigation = primarySelectionNavigation(edge);
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      click,
      navigation,
    );

    dom.emit('pointerdown', pointer(1, 10, 20));
    dom.emit('pointermove', pointer(1, 30, 40));
    dom.emit('pointerup', pointer(1, 10, 20));

    expect(navigation.claim).toHaveBeenCalledOnce();
    expect(navigation.begin).toHaveBeenCalledOnce();
    expect(edge.update).toHaveBeenCalledWith({ clientX: 30, clientY: 40 });
    expect(edge.finish).toHaveBeenCalledOnce();
    expect(edge.finish.mock.invocationCallOrder[0]).toBeLessThan(
      selection.up.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(click).not.toHaveBeenCalled();
    dispose();
  });

  it('replaces the character edge lease with the repeated-click semantic session', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const character = primarySelectionDragSession();
    const semantic = primarySelectionDragSession();
    const input = { owns: () => true };
    const claim = vi.fn(() => input);
    const begin = vi
      .fn<PrimarySelectionDragNavigation['begin']>()
      .mockImplementationOnce((_input, start) => {
        start();
        return character;
      })
      .mockImplementationOnce((_input, start) => {
        start();
        return semantic;
      });
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      vi.fn(),
      { begin, claim },
    );

    dom.emit('pointerdown', pointer(7, 10, 20));
    dom.emit('mousedown', mouseDown(2));
    dom.emit('pointermove', pointer(7, 50, 60));
    dom.emit('pointerup', pointer(7, 70, 80));

    expect(begin).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenCalledOnce();
    expect(character.cancel).toHaveBeenCalledOnce();
    expect(character.update).not.toHaveBeenCalled();
    expect(semantic.update).toHaveBeenCalledWith({ clientX: 50, clientY: 60 });
    expect(semantic.finish).toHaveBeenCalledOnce();
    dispose();
  });

  it('does not let an obsolete pointer mutate a replacement native selection', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    let owns = true;
    const edge = primarySelectionDragSession(false, () => owns);
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      vi.fn(),
      primarySelectionNavigation(edge),
    );

    dom.emit('pointerdown', pointer(1, 10, 20));
    owns = false;
    dom.emit('pointermove', pointer(1, 30, 40));
    dom.emit('pointercancel', pointer(1, 30, 40));
    dom.emit('pointerup', pointer(1, 30, 40));

    expect(edge.cancel).toHaveBeenCalledOnce();
    expect(selection.move).not.toHaveBeenCalled();
    expect(selection.up).not.toHaveBeenCalled();
    expect(selection.clear).not.toHaveBeenCalled();
    dispose();
  });

  it('rechecks exact ownership after edge shutdown before pointer finalization', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const edge = primarySelectionDragSession();
    edge.finish.mockReturnValue(false);
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      vi.fn(),
      primarySelectionNavigation(edge),
    );

    dom.emit('pointerdown', pointer(1, 10, 20));
    dom.emit('pointerup', pointer(1, 30, 40));

    expect(edge.finish).toHaveBeenCalledOnce();
    expect(selection.up).not.toHaveBeenCalled();
    dispose();
  });

  it.each([
    { detail: 2, granularity: 'word' },
    { detail: 3, granularity: 'paragraph' },
    { detail: 4, granularity: 'paragraph' },
  ] as const)(
    'upgrades mousedown detail $detail to $granularity and suppresses target activation',
    ({ detail, granularity }) => {
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
      dom.emit('mousedown', mouseDown(detail));
      dom.emit('pointerup', pointer(1, 10, 20));

      expect(selection.down.mock.calls).toEqual([
        [{ x: 10, y: 20 }],
        [{ x: 10, y: 20 }, granularity],
      ]);
      expect(selection.up).toHaveBeenCalledWith({ x: 10, y: 20 });
      expect(click).not.toHaveBeenCalled();
      dispose();
    },
  );

  it.each([
    { detail: 2, granularity: 'word' },
    { detail: 3, granularity: 'paragraph' },
  ] as const)(
    'keeps the original $granularity anchor while dragging',
    ({ detail, granularity }) => {
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
      dom.emit('mousedown', mouseDown(detail));
      dom.emit('pointermove', pointer(7, 50, 60));
      dom.emit('pointerup', pointer(7, 70, 80));

      expect(selection.down).toHaveBeenLastCalledWith({ x: 10, y: 20 }, granularity);
      expect(selection.move).toHaveBeenCalledWith({ x: 50, y: 60 });
      expect(selection.up).toHaveBeenCalledWith({ x: 70, y: 80 });
      expect(click).not.toHaveBeenCalled();
      dispose();
    },
  );

  it('does not infer click count from PointerEvent.detail', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const click = vi.fn();
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      click,
    );

    dom.emit('pointerdown', pointer(1, 10, 20, 'mouse', 3));
    dom.emit('pointerup', pointer(1, 10, 20, 'mouse', 3));

    expect(selection.down).toHaveBeenCalledOnce();
    expect(selection.down).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(click).toHaveBeenCalledOnce();
    dispose();
  });

  it('keeps pen input on the character path and preserves single-click dispatch', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const click = vi.fn();
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      click,
    );

    dom.emit('pointerdown', pointer(3, 10, 20, 'pen'));
    dom.emit('mousedown', mouseDown(2));
    dom.emit('pointerup', pointer(3, 10, 20, 'pen'));

    expect(selection.down).toHaveBeenCalledOnce();
    expect(selection.down).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(selection.up).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(click).toHaveBeenCalledWith({ x: 10, y: 20 });
    dispose();
  });

  it('dispatches the first native click cycle but suppresses the word-selection cycle', () => {
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
    dom.emit('mousedown', mouseDown(1));
    dom.emit('pointerup', pointer(1, 10, 20));
    expect(click).toHaveBeenCalledOnce();

    dom.emit('pointerdown', pointer(2, 10, 20));
    dom.emit('mousedown', mouseDown(2));
    dom.emit('pointerup', pointer(2, 10, 20));

    expect(selection.down.mock.calls).toEqual([
      [{ x: 10, y: 20 }],
      [{ x: 10, y: 20 }],
      [{ x: 10, y: 20 }, 'word'],
    ]);
    expect(click).toHaveBeenCalledTimes(1);
    dispose();
  });

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

  it('finalizes an active pointer when capture is lost after button release', () => {
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
    dom.emit('pointermove', pointer(7, 30, 40));
    dom.emit('lostpointercapture', lostPointerCapture(7, 50, 60, 0));
    dom.emit('pointerup', pointer(7, 70, 80));

    expect(selection.up).toHaveBeenCalledOnce();
    expect(selection.up).toHaveBeenCalledWith({ x: 50, y: 60 });
    expect(selection.clear).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
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
    dom.emit('lostpointercapture', lostPointerCapture(9, 10, 20, 1));
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

function lostPointerCapture(
  pointerId: number,
  clientX: number,
  clientY: number,
  buttons: number,
): PointerEvent {
  return {
    pointerId,
    pointerType: 'mouse',
    button: -1,
    buttons,
    clientX,
    clientY,
    detail: 0,
  } as PointerEvent;
}

describe('touch selection wiring', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tracks the original touch identity through long-press selection', () => {
    vi.useFakeTimers();
    const harness = createTouchSelectionHarness();
    const first = touch(1, 10, 20);
    const second = touch(2, 70, 80);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    harness.dom.emit('touchstart', touchEvent([first, second], [second]));
    vi.advanceTimersByTime(350);

    expect(harness.selection.down).toHaveBeenCalledTimes(1);
    expect(harness.selection.down).toHaveBeenCalledWith({ x: 10, y: 20 }, 'word');

    const movedFirst = touch(1, 30, 40);
    const movedSecond = touch(2, 90, 100);
    harness.dom.emit('touchmove', touchEvent([first, movedSecond], [movedSecond]));
    expect(harness.selection.move).not.toHaveBeenCalled();

    const preventDefault = vi.fn();
    const selectionMove = touchEvent([movedSecond, movedFirst], [movedFirst], 0, preventDefault);
    harness.dom.emit('touchmove', selectionMove);
    expect(harness.selection.move).toHaveBeenCalledWith({ x: 30, y: 40 });
    expect(preventDefault).toHaveBeenCalledOnce();

    harness.dom.emit('touchend', touchEvent([movedFirst], [movedSecond]));
    expect(harness.selection.up).not.toHaveBeenCalled();

    harness.dom.emit('touchend', touchEvent([], [movedFirst]));
    expect(harness.selection.up).toHaveBeenCalledWith({ x: 30, y: 40 });
    expect(harness.tap).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });

  it('routes long-press client input through one edge session and finishes it before selection', () => {
    vi.useFakeTimers();
    const edge = {
      ...primarySelectionDragSession(),
      resolveFinalInput: vi.fn(() => ({ x: 100, y: 40 })),
    } satisfies PrimarySelectionDragSession;
    const navigation = primarySelectionNavigation(edge);
    let scale = 1;
    navigation.claim.mockImplementation(() => {
      scale = 2;
      return { owns: () => true };
    });
    const harness = createTouchSelectionHarness(navigation, (value) => ({
      x: value.clientX / scale,
      y: value.clientY / scale,
    }));
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    expect(navigation.claim).toHaveBeenCalledOnce();
    expect(navigation.begin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    const moved = touch(1, 30, 40);
    harness.dom.emit('touchmove', touchEvent([moved], [moved]));
    harness.dom.emit('touchend', touchEvent([], [moved]));

    expect(navigation.begin).toHaveBeenCalledOnce();
    expect(harness.selection.down).toHaveBeenCalledWith({ x: 5, y: 10 }, 'word');
    expect(edge.update).toHaveBeenCalledWith({ clientX: 30, clientY: 40 });
    expect(edge.finish).toHaveBeenCalledOnce();
    expect(edge.resolveFinalInput).toHaveBeenCalledWith({ clientX: 30, clientY: 40 });
    expect(harness.selection.up).toHaveBeenCalledWith({ x: 100, y: 40 });
    expect(edge.finish.mock.invocationCallOrder[0]).toBeLessThan(
      harness.selection.up.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(edge.cancel).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });

  it('aborts long-press edge work before clearing a cancelled touch selection', () => {
    vi.useFakeTimers();
    const edge = primarySelectionDragSession();
    const harness = createTouchSelectionHarness(primarySelectionNavigation(edge));
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    harness.dom.emit('touchcancel', touchEvent([], [first]));

    expect(edge.cancel).toHaveBeenCalledOnce();
    expect(edge.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      harness.selection.clear.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(edge.finish).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });

  it('does not overwrite selection mode when clear synchronously starts a replacement', () => {
    vi.useFakeTimers();
    const edge = primarySelectionDragSession();
    const harness = createTouchSelectionHarness(primarySelectionNavigation(edge));
    const first = touch(1, 10, 20);
    harness.selection.clear.mockImplementation(() => {
      harness.selection.setState('selecting');
    });

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    harness.dom.emit('touchcancel', touchEvent([], [first]));

    expect(harness.selection.clear).toHaveBeenCalledOnce();
    expect(harness.setMode.mock.calls).toEqual([['selection']]);
    harness.disposables.disposeAll();
  });

  it('does not let an obsolete touch mutate a replacement native selection', () => {
    vi.useFakeTimers();
    let owns = true;
    const edge = primarySelectionDragSession(false, () => owns);
    const harness = createTouchSelectionHarness(primarySelectionNavigation(edge));
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    owns = false;
    const moved = touch(1, 30, 40);
    harness.dom.emit('touchmove', touchEvent([moved], [moved]));
    harness.dom.emit('touchcancel', touchEvent([], [moved]));
    harness.dom.emit('touchend', touchEvent([], [moved]));

    expect(edge.cancel).toHaveBeenCalledOnce();
    expect(harness.selection.move).not.toHaveBeenCalled();
    expect(harness.selection.up).not.toHaveBeenCalled();
    expect(harness.selection.clear).not.toHaveBeenCalled();
    expect(harness.setMode).toHaveBeenLastCalledWith('gesture');
    harness.disposables.disposeAll();
  });

  it('clears the exact touch session superseded only by pending content navigation', () => {
    vi.useFakeTimers();
    let ownsIntent = true;
    const edge = primarySelectionDragSession(
      false,
      () => ownsIntent,
      () => true,
      () => true,
    );
    const harness = createTouchSelectionHarness(primarySelectionNavigation(edge));
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    ownsIntent = false;
    const moved = touch(1, 30, 40);
    harness.dom.emit('touchmove', touchEvent([moved], [moved]));

    expect(edge.cancel).toHaveBeenCalledOnce();
    expect(harness.selection.clear).toHaveBeenCalledOnce();
    expect(harness.selection.move).not.toHaveBeenCalled();
    expect(harness.setMode).toHaveBeenLastCalledWith('gesture');
    harness.disposables.disposeAll();
  });

  it('clears the exact touch session when pending navigation wins at release', () => {
    vi.useFakeTimers();
    let ownsIntent = true;
    const edge = primarySelectionDragSession(
      false,
      () => ownsIntent,
      () => true,
      () => true,
    );
    const harness = createTouchSelectionHarness(primarySelectionNavigation(edge));
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    ownsIntent = false;
    harness.dom.emit('touchend', touchEvent([], [first]));

    expect(edge.cancel).toHaveBeenCalledOnce();
    expect(harness.selection.clear).toHaveBeenCalledOnce();
    expect(harness.selection.up).not.toHaveBeenCalled();
    expect(harness.setMode).toHaveBeenLastCalledWith('gesture');
    harness.disposables.disposeAll();
  });

  it('restores gesture mode when a rejected long-press is released without moving', () => {
    vi.useFakeTimers();
    const edge = primarySelectionDragSession(false, () => false);
    const harness = createTouchSelectionHarness(primarySelectionNavigation(edge));
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    harness.dom.emit('touchend', touchEvent([], [first]));

    expect(edge.cancel).toHaveBeenCalledOnce();
    expect(harness.selection.up).not.toHaveBeenCalled();
    expect(harness.setMode).toHaveBeenLastCalledWith('gesture');
    harness.disposables.disposeAll();
  });

  it('clears an exact long-press rejected synchronously by content navigation', () => {
    vi.useFakeTimers();
    const edge = primarySelectionDragSession(
      false,
      () => false,
      () => true,
      () => true,
    );
    const harness = createTouchSelectionHarness(primarySelectionNavigation(edge));
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);

    expect(edge.cancel).toHaveBeenCalledOnce();
    expect(harness.selection.clear).toHaveBeenCalledOnce();
    expect(harness.setMode).toHaveBeenLastCalledWith('gesture');
    harness.disposables.disposeAll();
  });

  it('keeps a word seed when long-press is released without moving', () => {
    vi.useFakeTimers();
    const harness = createTouchSelectionHarness();
    const first = touch(1, 10, 20);

    harness.dom.emit('touchstart', touchEvent([first], [first]));
    vi.advanceTimersByTime(350);
    harness.dom.emit('touchend', touchEvent([], [first]));

    expect(harness.selection.down).toHaveBeenCalledWith({ x: 10, y: 20 }, 'word');
    expect(harness.selection.move).not.toHaveBeenCalled();
    expect(harness.selection.up).toHaveBeenCalledWith({ x: 10, y: 20 });
    expect(harness.selection.clear).not.toHaveBeenCalled();
    expect(harness.tap).not.toHaveBeenCalled();
    harness.disposables.disposeAll();
  });

  it('touchcancel clears a pending timer and never turns it into a tap or selection', () => {
    vi.useFakeTimers();
    const harness = createTouchSelectionHarness();
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
    const harness = createTouchSelectionHarness();
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
    expect(harness.selection.down).toHaveBeenCalledWith({ x: 10, y: 20 }, 'word');
    expect(harness.selection.up).not.toHaveBeenCalled();
    expect(harness.tap).not.toHaveBeenCalled();
    expect(harness.setMode).toHaveBeenLastCalledWith('gesture');
    harness.disposables.disposeAll();
  });

  it('touchcancel cancels page tracking without committing the gesture', () => {
    const harness = createTouchSelectionHarness();
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
