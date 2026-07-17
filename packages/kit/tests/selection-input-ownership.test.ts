import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrimarySelectionDragNavigation } from '../src/controller/facade/selection-primary-drag';
import { SELECTION_EDGE_DWELL_MS } from '../src/controller/facade/selection-edge-navigation';
import type { Internals } from '../src/controller/facade/types';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import type { PrimarySelectionDragNavigation } from '../src/controller/wiring/selection-drag';
import { registerLegacySelectionGestureOwner } from '../src/interaction/selection/legacy-engine-gesture';
import {
  captureSelectionGesture,
  captureSelectionInteraction,
  isSelectionGestureSuperseded,
  ownsSelectionGesture,
} from '../src/interaction/selection/selection-interaction-owner';
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

  it('gives the legacy engine an exact lease that distinguishes settlement from replacement', () => {
    const selection = createSelectionHarness();
    selection.down.mockImplementation(() => {
      selection.setState('selecting');
    });
    selection.up.mockImplementation(() => {
      selection.setState('selected');
    });
    const engine = registerLegacySelectionGestureOwner(selection.engine);
    const before = captureSelectionInteraction(engine);

    engine.handlePointerDown({ x: 10, y: 20 });
    const first = captureSelectionGesture(engine);

    expect(before).not.toBeNull();
    expect(first?.generation).toBe((before?.generation ?? -1) + 1);
    expect(first && ownsSelectionGesture(first)).toBe(true);

    engine.handlePointerUp({ x: 10, y: 20 });
    expect(first && ownsSelectionGesture(first)).toBe(false);
    expect(first && isSelectionGestureSuperseded(first)).toBe(false);

    engine.handlePointerDown({ x: 10, y: 20 });
    expect(first && isSelectionGestureSuperseded(first)).toBe(true);
  });

  it('keeps legacy exact ownership without enabling unsupported spread projection', () => {
    vi.useFakeTimers();
    const selection = createSelectionHarness();
    selection.down.mockImplementation(() => {
      selection.setState('selecting');
    });
    const engine = registerLegacySelectionGestureOwner(selection.engine);
    const internals = {
      currentSpread: 0,
      reader: { totalSpreads: 2, pagination: { complete: true } },
      engines: { selection: engine },
      coordState: {
        contentInteractionGeneration: 0,
        selectionProjectionTransfer: null,
      },
    } as unknown as Internals;
    const prepareSpreadForJump = vi.fn(() => 'ready' as const);
    const jumpToSpreadIfReady = vi.fn(() => 'committed' as const);
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 200 }),
    } as unknown as HTMLCanvasElement;
    const navigation = createPrimarySelectionDragNavigation(internals, canvas, {
      ensureSelectionSpread: vi.fn(),
      prepareSpreadForJump,
      jumpToSpreadIfReady,
      supersedeForSelectionIntent: () => {
        internals.coordState.contentInteractionGeneration += 1;
        return { owns: () => true };
      },
    } as never);
    const input = navigation.claim();
    if (!input) throw new Error('missing legacy selection input');
    const session = navigation.begin(input, () => {
      engine.handlePointerDown({ x: 10, y: 20 });
    });

    session?.update({ clientX: 299, clientY: 20 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(session?.owns()).toBe(true);
    expect(engine.getState()).toBe('selecting');
    expect(prepareSpreadForJump).not.toHaveBeenCalled();
    expect(jumpToSpreadIfReady).not.toHaveBeenCalled();
  });

  it('settles a legacy lease even when pointer-up listeners throw', () => {
    const selection = createSelectionHarness();
    selection.down.mockImplementation(() => {
      selection.setState('selecting');
    });
    selection.up.mockImplementation(() => {
      selection.setState('selected');
      throw new Error('listener failed');
    });
    const engine = registerLegacySelectionGestureOwner(selection.engine);
    engine.handlePointerDown({ x: 10, y: 20 });
    const lease = captureSelectionGesture(engine);
    if (!lease) throw new Error('missing legacy selection lease');

    expect(() => {
      engine.handlePointerUp({ x: 10, y: 20 });
    }).toThrow('listener failed');
    expect(ownsSelectionGesture(lease)).toBe(false);
    expect(isSelectionGestureSuperseded(lease)).toBe(false);
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
