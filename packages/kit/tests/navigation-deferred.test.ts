import { describe, expect, it, vi } from 'vitest';
import type { Reader, Spread } from '@ritojs/core';
import {
  createNavigation,
  type GestureNavigationToken,
  type NavigationDeps,
} from '../src/controller/navigation';

function createNotifyRedirectFixture() {
  let currentSpread = 0;
  let redirected = false;
  const notified: number[] = [];
  const spreadEvents: number[] = [];
  const redirect: { current?: () => void } = {};
  const goToTarget = vi.fn();
  const scheduleComposite = vi.fn();
  const spreads = [{}, {}, {}];
  const reader = {
    totalSpreads: spreads.length,
    spreads,
    notifyActiveSpread: vi.fn((spreadIndex: number) => {
      notified.push(spreadIndex);
      if (spreadIndex !== 1 || redirected) return;
      redirected = true;
      redirect.current?.();
    }),
  } as unknown as Reader;
  const deps = {
    getReader: () => reader,
    getCurrentSpread: () => currentSpread,
    setCurrentSpread: (index: number) => {
      currentSpread = index;
    },
    emitter: {
      emit: vi.fn((event: string, payload: { spreadIndex?: number }) => {
        if (event === 'spreadChange' && payload.spreadIndex !== undefined) {
          spreadEvents.push(payload.spreadIndex);
        }
      }),
    },
    td: { isAnimating: false, goToTarget },
    frameDriver: { scheduleComposite },
    pool: {
      getSlotFor: vi.fn(() => null),
      assignSlot: vi.fn(),
      ensureContent: vi.fn(() => true),
      jump: vi.fn(),
    },
    contentRenderer: vi.fn(),
    onNavigationIntent: vi.fn(),
  } as unknown as NavigationDeps;
  const nav = createNavigation(deps);
  redirect.current = () => {
    nav.goToSpread(2);
  };
  return {
    nav,
    deps,
    notified,
    spreadEvents,
    goToTarget,
    scheduleComposite,
    getCurrentSpread: () => currentSpread,
  };
}

describe('navigation deferred content', () => {
  it('claims position intent before waiting for async content', () => {
    let currentSpread = 0;
    const onNavigationIntent = vi.fn();
    const onContentInteractionIntent = vi.fn();
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
      td: { isAnimating: false, viewportWidth: 800, forceSettle: vi.fn(), goToTarget: vi.fn() },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => false),
        jump: vi.fn(),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent,
      onContentInteractionIntent,
    } as unknown as NavigationDeps;

    createNavigation(deps).goToSpread(1);

    expect(onNavigationIntent).toHaveBeenCalledOnce();
    expect(onContentInteractionIntent).toHaveBeenCalledOnce();
    expect(currentSpread).toBe(0);
  });

  it('recaptures when pending navigation is replaced by a no-op current target', () => {
    let currentSpread = 0;
    let tocSpread: number | undefined = 0;
    const onNavigationCancelled = vi.fn();
    const entry = { label: 'Current', href: 'current.xhtml', children: [] };
    const reader = {
      totalSpreads: 2,
      spreads: [{}, {}],
      resolveTocEntry: vi.fn(() =>
        tocSpread === undefined ? undefined : { pageIndex: 0, spreadIndex: tocSpread },
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
      td: { isAnimating: false, viewportWidth: 800, forceSettle: vi.fn(), goToTarget: vi.fn() },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent: vi.fn(() => false),
        jump: vi.fn(),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
      onNavigationCancelled,
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);

    nav.goToSpread(1);
    nav.goToSpread(0);
    nav.startGestureNavigation(1, vi.fn());
    nav.navigateToTocEntry(entry);
    tocSpread = undefined;
    nav.navigateToTocEntry(entry);
    tocSpread = 0;
    nav.notifyLayoutCommitted();
    nav.startGestureNavigation(1, vi.fn());
    nav.jumpToSpread(0, true);

    expect(onNavigationCancelled).toHaveBeenCalledTimes(3);
    expect(currentSpread).toBe(0);
  });

  it('silently clears older pending content, gesture, and TOC work for a position intent', () => {
    let currentSpread = 0;
    let contentReady = false;
    let tocReady = false;
    const onNavigationCancelled = vi.fn();
    const onContentInteractionIntent = vi.fn();
    const gestureStarted = vi.fn();
    const goToTarget = vi.fn();
    const entry = { label: 'Target', href: 'target.xhtml', children: [] };
    const reader = {
      totalSpreads: 3,
      spreads: [{}, {}, {}],
      resolveTocEntry: vi.fn(() => (tocReady ? { pageIndex: 2, spreadIndex: 2 } : undefined)),
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
        ensureContent: vi.fn(() => contentReady),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
      onContentInteractionIntent,
      onNavigationCancelled,
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);

    const gesture = nav.startGestureNavigation(1, gestureStarted);
    nav.supersedeForPositionIntent();
    contentReady = true;
    nav.notifyContentReady(1);
    gesture.cancel();

    tocReady = false;
    nav.navigateToTocEntry(entry);
    nav.supersedeForPositionIntent();
    tocReady = true;
    nav.notifyLayoutCommitted();

    expect(currentSpread).toBe(0);
    expect(goToTarget).not.toHaveBeenCalled();
    expect(gestureStarted).not.toHaveBeenCalled();
    expect(onNavigationCancelled).not.toHaveBeenCalled();
    expect(onContentInteractionIntent).toHaveBeenCalledTimes(4);
  });

  it('lets navigation from force-settle callbacks supersede the position intent', () => {
    let currentSpread = 0;
    let animating = true;
    const navigation: { current?: ReturnType<typeof createNavigation> } = {};
    const goToTarget = vi.fn();
    const onNavigationIntent = vi.fn();
    const reader = {
      totalSpreads: 3,
      spreads: [{}, {}, {}],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const forceSettle = vi.fn(() => {
      animating = false;
      navigation.current?.goToSpread(2);
      return 0;
    });
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
        ensureContent: vi.fn(() => true),
      },
      contentRenderer: vi.fn(),
      onNavigationIntent,
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);
    navigation.current = nav;

    nav.supersedeForPositionIntent();

    expect(forceSettle).toHaveBeenCalledOnce();
    expect(onNavigationIntent).toHaveBeenCalledOnce();
    expect(currentSpread).toBe(2);
    expect(goToTarget).toHaveBeenCalledWith('forward', 0, 2, 0);
  });

  it('does not let a stale jump overwrite navigation from its force-settle callback', () => {
    let currentSpread = 0;
    let animating = true;
    const navigation: { current?: ReturnType<typeof createNavigation> } = {};
    const notified: number[] = [];
    const goToTarget = vi.fn();
    const jump = vi.fn();
    const reader = {
      totalSpreads: 3,
      spreads: [{}, {}, {}],
      notifyActiveSpread: vi.fn((spreadIndex: number) => {
        notified.push(spreadIndex);
      }),
    } as unknown as Reader;
    const forceSettle = vi.fn(() => {
      animating = false;
      navigation.current?.goToSpread(2);
      return 0;
    });
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
        ensureContent: vi.fn(() => true),
        jump,
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);
    navigation.current = nav;

    nav.jumpToSpread(1, true);

    expect(forceSettle).toHaveBeenCalledOnce();
    expect(currentSpread).toBe(2);
    expect(notified).toEqual([2]);
    expect(jump).not.toHaveBeenCalled();
    expect(goToTarget).toHaveBeenCalledOnce();
    expect(goToTarget).toHaveBeenCalledWith('forward', 0, 2, 0);
  });

  it('installs jump content before a spread listener can redirect synchronously', () => {
    let currentSpread = 0;
    const order: string[] = [];
    const notifyActiveSpread = vi.fn((spreadIndex: number) => {
      order.push(`notify:${String(spreadIndex)}`);
    });
    const reader = {
      totalSpreads: 3,
      spreads: [{}, {}, {}],
      notifyActiveSpread,
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter: {
        emit: vi.fn((event: string) => {
          if (event === 'spreadChange') {
            order.push('spreadChange');
            currentSpread = 2;
          }
        }),
      },
      td: { isAnimating: false },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: { jump: vi.fn(), ensureContent: vi.fn() },
      contentRenderer: vi.fn(),
    } as unknown as NavigationDeps;

    createNavigation(deps).jumpToSpread(1, true);

    expect(currentSpread).toBe(2);
    expect(order).toEqual(['notify:1', 'spreadChange']);
  });

  it('does not emit a stale jump event when active-spread notification redirects', () => {
    const fixture = createNotifyRedirectFixture();

    fixture.nav.jumpToSpread(1, true);

    expect(fixture.getCurrentSpread()).toBe(2);
    expect(fixture.notified).toEqual([1, 2]);
    expect(fixture.spreadEvents).toEqual([2]);
    expect(fixture.goToTarget).toHaveBeenCalledOnce();
    expect(fixture.goToTarget).toHaveBeenCalledWith('forward', 1, 2, 0);
    expect(fixture.scheduleComposite).toHaveBeenCalledOnce();
  });

  it('does not resume an old transition after a spread listener redirects synchronously', () => {
    let currentSpread = 0;
    const redirect: { current?: () => void } = {};
    const notified: number[] = [];
    const notifyActiveSpread = vi.fn((spreadIndex: number) => {
      notified.push(spreadIndex);
    });
    const goToTarget = vi.fn();
    const reader = {
      totalSpreads: 3,
      spreads: [{}, {}, {}],
      notifyActiveSpread,
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter: {
        emit: vi.fn((event: string) => {
          if (event === 'spreadChange') redirect.current?.();
        }),
      },
      td: { isAnimating: false, goToTarget },
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
    redirect.current = () => {
      nav.goToSpread(2);
    };

    nav.goToSpread(1);

    expect(currentSpread).toBe(2);
    expect(notified).toEqual([1, 2]);
    expect(goToTarget).not.toHaveBeenCalled();
  });

  it('does not emit a stale transition event when active-spread notification redirects', () => {
    const fixture = createNotifyRedirectFixture();

    fixture.nav.goToSpread(1);

    expect(fixture.getCurrentSpread()).toBe(2);
    expect(fixture.notified).toEqual([1, 2]);
    expect(fixture.spreadEvents).toEqual([2]);
    expect(fixture.goToTarget).toHaveBeenCalledOnce();
    expect(fixture.goToTarget).toHaveBeenCalledWith('forward', 1, 2, 0);
    expect(fixture.scheduleComposite).toHaveBeenCalledOnce();
  });

  it('preserves a nested deferred request when the outer spread listener redirects', () => {
    let currentSpread = 0;
    let redirected = false;
    const goToTarget = vi.fn();
    const ensureContent = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const reader = {
      totalSpreads: 3,
      spreads: [{}, {}, {}],
      notifyActiveSpread: vi.fn(),
    } as unknown as Reader;
    const redirect: { current?: () => void } = {};
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter: {
        emit: vi.fn((event: string) => {
          if (event !== 'spreadChange' || redirected) return;
          redirected = true;
          redirect.current?.();
        }),
      },
      td: { isAnimating: false, goToTarget },
      frameDriver: { scheduleComposite: vi.fn() },
      pool: {
        getSlotFor: vi.fn(() => null),
        assignSlot: vi.fn(),
        ensureContent,
      },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);
    redirect.current = () => {
      nav.goToSpread(2);
    };

    nav.goToSpread(1);

    expect(currentSpread).toBe(1);
    expect(goToTarget).not.toHaveBeenCalled();

    nav.notifyContentReady(2);

    expect(currentSpread).toBe(2);
    expect(goToTarget).toHaveBeenCalledOnce();
    expect(goToTarget).toHaveBeenCalledWith('forward', 1, 2, 0);
  });

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

  it('does not start a deferred gesture cancelled by its active-spread notification', () => {
    let currentSpread = 0;
    let contentReady = false;
    const gesture: { token?: GestureNavigationToken } = {};
    const spread = {} as Spread;
    const goToTarget = vi.fn();
    const onTransitionStart = vi.fn();
    const onNavigationCancelled = vi.fn();
    const emit = vi.fn();
    const scheduleComposite = vi.fn();
    const notifications: number[] = [];
    const slots: {
      prev: number | null;
      curr: number | null;
      next: number | null;
    } = { prev: null, curr: 0, next: null };
    const reader = {
      totalSpreads: 2,
      spreads: [spread, spread],
      notifyActiveSpread: vi.fn((spreadIndex: number) => {
        notifications.push(spreadIndex);
        if (spreadIndex === 1) gesture.token?.cancel();
      }),
    } as unknown as Reader;
    const deps = {
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter: { emit },
      td: { isAnimating: false, goToTarget },
      frameDriver: { scheduleComposite },
      pool: {
        getSlotFor: vi.fn((spreadIndex: number) => {
          if (slots.prev === spreadIndex) return 'prev';
          if (slots.curr === spreadIndex) return 'curr';
          if (slots.next === spreadIndex) return 'next';
          return null;
        }),
        assignSlot: vi.fn((slot: 'prev' | 'curr' | 'next', spreadIndex: number) => {
          slots[slot] = spreadIndex;
        }),
        ensureContent: vi.fn(() => contentReady),
      },
      contentRenderer: vi.fn(),
      onNavigationCancelled,
    } as unknown as NavigationDeps;
    const nav = createNavigation(deps);
    gesture.token = nav.startGestureNavigation(1, onTransitionStart);

    contentReady = true;
    nav.notifyContentReady(1);

    expect(goToTarget).not.toHaveBeenCalled();
    expect(onTransitionStart).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalledWith('transitionStart', expect.anything());
    expect(emit).not.toHaveBeenCalledWith('spreadChange', expect.anything());
    expect(currentSpread).toBe(0);
    expect(slots).toEqual({ prev: null, curr: 0, next: 1 });
    expect(notifications).toEqual([1, 0]);
    expect(onNavigationCancelled).toHaveBeenCalledOnce();
    expect(scheduleComposite).toHaveBeenCalledTimes(2);
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
