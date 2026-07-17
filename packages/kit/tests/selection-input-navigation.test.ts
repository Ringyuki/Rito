import type { Reader } from '@ritojs/core';
import { describe, expect, it, vi } from 'vitest';
import { createPrimarySelectionDragNavigation } from '../src/controller/facade/selection-primary-drag';
import type { Internals } from '../src/controller/facade/types';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import { registerSelectionInteractionOwner } from '../src/interaction/selection/selection-interaction-owner';
import { createDomTarget, pointer, pointerPosition } from './helpers/dom-input';

describe('selection input navigation ownership', () => {
  it('retires older deferred navigation before a naturally empty native click', () => {
    let contentReady = false;
    let selectionGeneration = 0;
    let activeGesture: object | null = null;
    let selectionState: 'idle' | 'selecting' = 'idle';
    const selection = registerSelectionInteractionOwner(
      {
        handlePointerDown: () => {
          selectionGeneration += 1;
          activeGesture = {};
          selectionState = 'selecting';
        },
        handlePointerMove: vi.fn(),
        handlePointerUp: vi.fn(),
        clear: vi.fn(),
        getState: () => selectionState,
      },
      () => selectionGeneration,
      {
        capture: () => activeGesture,
        owns: (candidate) => candidate === activeGesture && selectionState === 'selecting',
      },
    );
    const reader = {
      totalSpreads: 2,
      spreads: [{}, {}],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const goToTarget = vi.fn();
    const onNavigationCancelled = vi.fn();
    const internals = {
      currentSpread: 0,
      reader,
      engines: { selection },
      coordState: {
        mapper: null,
        contentInteractionGeneration: 0,
        selectionProjectionTransfer: null,
      },
    } as unknown as Internals;
    const nav = createNavigation({
      getReader: () => reader,
      getCurrentSpread: () => internals.currentSpread,
      setCurrentSpread: (index: number) => {
        internals.currentSpread = index;
      },
      emitter: { emit: vi.fn() },
      td: { isAnimating: false, goToTarget },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => contentReady),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
      onContentInteractionIntent: () => {
        internals.coordState.contentInteractionGeneration += 1;
      },
      onNavigationCancelled,
    } as unknown as NavigationDeps);
    const dom = createDomTarget();
    const canvas = dom.target as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 200 }) as DOMRect;
    const click = vi.fn();
    const dispose = bindPointerEvents(
      canvas,
      selection as never,
      pointerPosition,
      click,
      createPrimarySelectionDragNavigation(internals, canvas, nav),
    );

    nav.goToSpread(1);
    dom.emit('pointerdown', pointer(1, 10, 20));
    activeGesture = null;
    selectionState = 'idle';
    contentReady = true;
    nav.notifyContentReady(1);
    dom.emit('pointerup', pointer(1, 10, 20));

    expect(internals.currentSpread).toBe(0);
    expect(goToTarget).not.toHaveBeenCalled();
    expect(onNavigationCancelled).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledWith({ x: 10, y: 20 });
    dispose();
  });
});
