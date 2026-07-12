import { describe, expect, it, vi } from 'vitest';
import type { Reader, Spread } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';

describe('navigation deferred content', () => {
  it('waits for an async content slot before starting the page turn', () => {
    let currentSpread = 0;
    const spread = {} as Spread;
    const goToTarget = vi.fn();
    const emit = vi.fn();
    const ensureContent = vi.fn(() => false);
    const scheduleComposite = vi.fn();
    const notifyActiveSpread = vi.fn();
    const reader = {
      totalSpreads: 3,
      spreads: [spread, spread, spread],
      notifyActiveSpread,
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      getRenderScale: () => 1,
      emitter: { emit },
      td: {
        isAnimating: false,
        viewportWidth: 800,
        forceSettle: vi.fn(() => 0),
        goToTarget,
      },
      frameDriver: { scheduleComposite },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent,
      },
      contentRenderer: vi.fn(() => true),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);

    nav.goToSpread(1);

    expect(currentSpread).toBe(0);
    expect(goToTarget).not.toHaveBeenCalled();
    expect(scheduleComposite).toHaveBeenCalledTimes(1);

    ensureContent.mockReturnValue(true);
    nav.notifyContentReady(1);

    expect(currentSpread).toBe(1);
    expect(goToTarget).toHaveBeenCalledWith('forward', 0, 1, 0);
    expect(notifyActiveSpread).toHaveBeenCalledWith(1);
    expect(emit).toHaveBeenCalledWith('spreadChange', { spreadIndex: 1, spread });
  });

  it('continues a deferred nextSpread once the target content becomes ready', () => {
    let currentSpread = 0;
    const spread = {} as Spread;
    const goToTarget = vi.fn();
    const ensureContent = vi.fn(() => false);
    const reader = {
      totalSpreads: 3,
      spreads: [spread, spread, spread],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      getRenderScale: () => 1,
      emitter: { emit: vi.fn() },
      td: {
        isAnimating: false,
        viewportWidth: 800,
        forceSettle: vi.fn(() => 0),
        goToTarget,
      },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent,
      },
      contentRenderer: vi.fn(() => true),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);

    nav.nextSpread();

    expect(currentSpread).toBe(0);
    expect(goToTarget).not.toHaveBeenCalled();

    ensureContent.mockReturnValue(true);
    nav.notifyContentReady(1);

    expect(currentSpread).toBe(1);
    expect(goToTarget).toHaveBeenCalledWith('forward', 0, 1, 0);
  });

  it('a stale gesture token cannot cancel a newer programmatic request', () => {
    let currentSpread = 0;
    const spread = {} as Spread;
    const goToTarget = vi.fn();
    const ensureContent = vi.fn(() => false);
    const gestureStarted = vi.fn();
    const reader = {
      totalSpreads: 3,
      spreads: [spread, spread, spread],
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
        isAnimating: false,
        viewportWidth: 800,
        forceSettle: vi.fn(() => 0),
        goToTarget,
      },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent,
      },
      contentRenderer: vi.fn(() => true),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);

    const gesture = nav.startGestureNavigation(1, gestureStarted);
    nav.goToSpread(2);
    gesture.cancel();
    ensureContent.mockReturnValue(true);
    nav.notifyContentReady(2);

    expect(currentSpread).toBe(2);
    expect(goToTarget).toHaveBeenCalledWith('forward', 0, 2, 0);
    expect(gestureStarted).not.toHaveBeenCalled();
  });

  it('TOC and jump navigation replace a deferred gesture request', () => {
    let currentSpread = 0;
    let contentReady = false;
    const spread = {} as Spread;
    const entry = { label: 'Target', href: 'target.xhtml', children: [] };
    const goToTarget = vi.fn();
    const jump = vi.fn();
    const firstGestureStarted = vi.fn();
    const secondGestureStarted = vi.fn();
    const reader = {
      totalSpreads: 4,
      spreads: [spread, spread, spread, spread],
      resolveTocEntry: vi.fn(() => ({ pageIndex: 2, spreadIndex: 2 })),
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
        isAnimating: false,
        viewportWidth: 800,
        forceSettle: vi.fn(() => 0),
        goToTarget,
      },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => contentReady),
        jump,
      },
      contentRenderer: vi.fn(() => true),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);

    const tocGesture = nav.startGestureNavigation(1, firstGestureStarted);
    nav.navigateToTocEntry(entry);
    tocGesture.cancel();
    contentReady = true;
    nav.notifyContentReady(2);

    expect(currentSpread).toBe(2);
    expect(goToTarget).toHaveBeenLastCalledWith('forward', 0, 2, 0);
    expect(firstGestureStarted).not.toHaveBeenCalled();

    contentReady = false;
    goToTarget.mockClear();
    const jumpGesture = nav.startGestureNavigation(3, secondGestureStarted);
    nav.jumpToSpread(0);
    jumpGesture.cancel();
    contentReady = true;
    nav.notifyContentReady(3);

    expect(currentSpread).toBe(0);
    expect(jump).toHaveBeenCalledWith(0);
    expect(goToTarget).not.toHaveBeenCalled();
    expect(secondGestureStarted).not.toHaveBeenCalled();
  });

  it('retries a TOC target after a partial preview is replaced by a full layout', () => {
    let currentSpread = 0;
    const target = { spread: undefined as number | undefined };
    const entry = { label: 'Chapter 1', href: 'chapter-1.xhtml', children: [] };
    const spread = {} as Spread;
    const goToTarget = vi.fn();
    const reader = {
      totalSpreads: 12,
      spreads: Array.from({ length: 12 }, () => spread),
      resolveTocEntry: vi.fn(() =>
        target.spread === undefined ? undefined : { pageIndex: 8, spreadIndex: target.spread },
      ),
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
        isAnimating: false,
        viewportWidth: 800,
        forceSettle: vi.fn(() => 0),
        goToTarget,
      },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => true),
      },
      contentRenderer: vi.fn(() => true),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);

    nav.navigateToTocEntry(entry);
    expect(currentSpread).toBe(0);
    expect(goToTarget).not.toHaveBeenCalled();

    target.spread = 4;
    nav.notifyLayoutCommitted();

    expect(currentSpread).toBe(4);
    expect(goToTarget).toHaveBeenCalledWith('forward', 0, 4, 0);
  });
});
