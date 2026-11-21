import { describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';
import { fakeTurns } from './helpers/fake-turns';

function navigationDeps(
  reader: Reader,
  spread: { current: number },
  turns: ReturnType<typeof fakeTurns>,
  extra: Partial<NavigationDeps>,
): NavigationDeps {
  return {
    getReader: () => reader,
    getCurrentSpread: () => spread.current,
    setCurrentSpread: (index: number) => {
      spread.current = index;
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
    ...extra,
  } as unknown as NavigationDeps;
}

function landing(spread: { current: number }) {
  return fakeTurns(
    () => spread.current,
    (to) => {
      spread.current = to;
    },
  );
}

describe('navigation no-op ownership', () => {
  it('claims and recaptures current, boundary, and TOC targets without animation', () => {
    const spread = { current: 0 };
    const onNavigationIntent = vi.fn();
    const onNavigationCancelled = vi.fn();
    const entry = { label: 'Current', href: 'current.xhtml', children: [] };
    const reader = {
      totalSpreads: 1,
      spreads: [{}],
      resolveTocEntry: vi.fn(() => ({ pageIndex: 0, spreadIndex: 0 })),
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const turns = landing(spread);
    const nav = createNavigation(
      navigationDeps(reader, spread, turns, { onNavigationIntent, onNavigationCancelled }),
    );

    nav.goToSpread(0);
    nav.prevSpread();
    nav.nextSpread();
    nav.navigateToTocEntry(entry);

    expect(onNavigationIntent).toHaveBeenCalledTimes(4);
    expect(onNavigationCancelled).toHaveBeenCalledTimes(4);
    expect(turns.commands).toEqual([]);
    expect(spread.current).toBe(0);
  });

  it('does not recapture a stale no-op after its intent callback redirects synchronously', () => {
    const spread = { current: 0 };
    let redirected = false;
    const navigation: { current?: ReturnType<typeof createNavigation> } = {};
    const onNavigationCancelled = vi.fn();
    const reader = {
      totalSpreads: 2,
      spreads: [{}, {}],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const turns = landing(spread);
    const nav = createNavigation(
      navigationDeps(reader, spread, turns, {
        onNavigationIntent: vi.fn(() => {
          if (redirected) return;
          redirected = true;
          navigation.current?.goToSpread(1);
        }),
        onNavigationCancelled,
      }),
    );
    navigation.current = nav;

    nav.goToSpread(0);

    expect(spread.current).toBe(1);
    expect(onNavigationCancelled).not.toHaveBeenCalled();
    expect(turns.commands).toEqual([['next', 0, 1]]);
  });

  it('turns a step from where a turn on screen has landed the reader', () => {
    const spread = { current: 0 };
    const onNavigationCancelled = vi.fn();
    const reader = {
      totalSpreads: 2,
      spreads: [{}, {}],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const turns = landing(spread);
    const nav = createNavigation(
      navigationDeps(reader, spread, turns, { onNavigationIntent: vi.fn(), onNavigationCancelled }),
    );

    nav.nextSpread();
    // The turn on screen has landed the reader on spread 1: asking for it is no turn.
    nav.goToSpread(1);

    expect(spread.current).toBe(1);
    expect(turns.commands).toEqual([['next', 0, 1]]);
    expect(onNavigationCancelled).toHaveBeenCalledOnce();
  });
});
