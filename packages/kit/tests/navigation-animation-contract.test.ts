import { describe, expect, it, vi } from 'vitest';
import type { Reader, TocEntry } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';
import { fakeTurns } from './helpers/fake-turns';

describe('navigation animation contract', () => {
  it('routes normal next, previous, and resolved TOC turns through the engine', () => {
    let currentSpread = 1;
    const turns = fakeTurns(
      () => currentSpread,
      (spread) => {
        currentSpread = spread;
      },
    );
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
      td: turns.td,
      turnTargets: turns.turnTargets,
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

    expect(turns.commands).toEqual([
      ['next', 1, 2],
      ['previous', 2, 1],
      ['previous', 1, 0],
    ]);
    expect(currentSpread).toBe(0);
  });
});
