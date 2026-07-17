import type { Reader } from '@ritojs/core';
import { describe, expect, it, vi } from 'vitest';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';

describe('navigation direct interaction ownership', () => {
  it('does not settle newer navigation started by pending gesture cancellation', () => {
    let currentSpread = 0;
    let contentReady = false;
    let animating = false;
    const forceSettle = vi.fn(() => {
      animating = false;
      return 0;
    });
    const goToTarget = vi.fn(() => {
      animating = true;
    });
    const reader = {
      totalSpreads: 3,
      spreads: [{}, {}, {}],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter: { emit: vi.fn() },
      td: {
        get isAnimating() {
          return animating;
        },
        forceSettle,
        goToTarget,
      },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => contentReady),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);
    nav.startGestureNavigation(1, vi.fn(), () => {
      nav.goToSpread(2);
    });
    contentReady = true;

    const barrier = nav.supersedeForSelectionIntent();

    expect(barrier).toBeNull();
    expect(currentSpread).toBe(2);
    expect(goToTarget).toHaveBeenCalledOnce();
    expect(forceSettle).not.toHaveBeenCalled();
    expect(animating).toBe(true);
  });
});
