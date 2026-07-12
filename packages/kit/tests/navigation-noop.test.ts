import { describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';

describe('navigation no-op ownership', () => {
  it('claims and recaptures current, boundary, and TOC targets without animation', () => {
    let currentSpread = 0;
    const onNavigationIntent = vi.fn();
    const onNavigationCancelled = vi.fn();
    const goToTarget = vi.fn();
    const assignSlot = vi.fn();
    const entry = { label: 'Current', href: 'current.xhtml', children: [] };
    const reader = {
      totalSpreads: 1,
      spreads: [{}],
      resolveTocEntry: vi.fn(() => ({ pageIndex: 0, spreadIndex: 0 })),
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter: { emit: vi.fn() },
      td: { isAnimating: false, goToTarget },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot,
        ensureContent: vi.fn(() => true),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent,
      onNavigationCancelled,
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);

    nav.goToSpread(0);
    nav.prevSpread();
    nav.nextSpread();
    nav.navigateToTocEntry(entry);

    expect(onNavigationIntent).toHaveBeenCalledTimes(4);
    expect(onNavigationCancelled).toHaveBeenCalledTimes(4);
    expect(goToTarget).not.toHaveBeenCalled();
    expect(assignSlot).not.toHaveBeenCalled();
    expect(currentSpread).toBe(0);
  });

  it('does not recapture a stale no-op after its intent callback redirects synchronously', () => {
    let currentSpread = 0;
    let redirected = false;
    const navigation: { current?: ReturnType<typeof createNavigation> } = {};
    const onNavigationCancelled = vi.fn();
    const goToTarget = vi.fn();
    const reader = {
      totalSpreads: 2,
      spreads: [{}, {}],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter: { emit: vi.fn() },
      td: { isAnimating: false, goToTarget },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => true),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(() => {
        if (redirected) return;
        redirected = true;
        navigation.current?.goToSpread(1);
      }),
      onNavigationCancelled,
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);
    navigation.current = nav;

    nav.goToSpread(0);

    expect(currentSpread).toBe(1);
    expect(onNavigationCancelled).not.toHaveBeenCalled();
    expect(goToTarget).toHaveBeenCalledOnce();
    expect(goToTarget).toHaveBeenCalledWith('forward', 0, 1, 0);
  });

  it('recaptures when settling the active transition reaches the requested target', () => {
    let currentSpread = 0;
    let animating = true;
    const onNavigationCancelled = vi.fn();
    const goToTarget = vi.fn();
    const reader = {
      totalSpreads: 2,
      spreads: [{}, {}],
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
        viewportWidth: 800,
        forceSettle: vi.fn(() => {
          animating = false;
          currentSpread = 1;
          return 0;
        }),
        goToTarget,
      },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => true),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
      onNavigationCancelled,
    } as unknown as NavigationDeps;

    createNavigation(deps).goToSpread(1);

    expect(currentSpread).toBe(1);
    expect(onNavigationCancelled).toHaveBeenCalledOnce();
    expect(goToTarget).not.toHaveBeenCalled();
  });
});
