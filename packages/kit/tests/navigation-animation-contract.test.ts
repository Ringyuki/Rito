import { describe, expect, it, vi } from 'vitest';
import type { Reader, TocEntry } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';

describe('navigation animation contract', () => {
  it('routes normal next, previous, and resolved TOC turns through TransitionDriver', () => {
    let currentSpread = 1;
    const goToTarget = vi.fn();
    const emit = vi.fn();
    const spreads = [{}, {}, {}];
    const tocEntry: TocEntry = { label: 'Start', href: 'start.xhtml', children: [] };
    const reader = {
      totalSpreads: spreads.length,
      spreads,
      resolveTocEntry: vi.fn(() => ({ pageIndex: 0, spreadIndex: 0 })),
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      getRenderScale: () => 1,
      emitter: { emit },
      td: { isAnimating: false, goToTarget },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => true),
      },
      contentRenderer: vi.fn(() => true),
    } as unknown as NavigationDeps;
    const navigation = createNavigation(deps);

    navigation.nextSpread();
    navigation.prevSpread();
    navigation.navigateToTocEntry(tocEntry);

    expect(goToTarget.mock.calls).toEqual([
      ['forward', 1, 2, 0],
      ['backward', 2, 1, 0],
      ['backward', 1, 0, 0],
    ]);
    expect(emit).toHaveBeenCalledWith('transitionStart', { direction: 'forward' });
    expect(emit).toHaveBeenCalledWith('transitionStart', { direction: 'backward' });
  });
});
