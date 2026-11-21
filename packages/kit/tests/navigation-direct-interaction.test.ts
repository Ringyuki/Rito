import type { Reader } from '@ritojs/core';
import { describe, expect, it, vi } from 'vitest';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';
import { fakeTurns } from './helpers/fake-turns';

describe('navigation direct interaction ownership', () => {
  it('settles the turn on screen where it was going, and turns go to the neighbours again', () => {
    let currentSpread = 0;
    const turns = fakeTurns(
      () => currentSpread,
      (spread) => {
        currentSpread = spread;
      },
    );
    const reader = {
      totalSpreads: 5,
      spreads: [{}, {}, {}, {}, {}],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter: { emit: vi.fn() },
      td: turns.td,
      turnTargets: turns.turnTargets,
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => true),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);
    nav.goToSpread(3);
    expect(turns.commands).toEqual([['next', 0, 3]]);
    // A turn waiting for its page, named to spread 0.
    turns.turnTargets.aim('previous', 0);

    const barrier = nav.supersedeForSelectionIntent();

    expect(barrier?.owns()).toBe(true);
    expect(turns.settleNow).toHaveBeenCalledOnce();
    expect(turns.animating).toBe(false);
    expect(currentSpread).toBe(3);
    expect(turns.turnTargets.of('next')).toBe(4);
    expect(turns.turnTargets.of('previous')).toBe(2);
  });
});
