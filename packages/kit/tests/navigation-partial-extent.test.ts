import { describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';

describe('partial-extent navigation', () => {
  it('grows a known tail once and resumes deferred content navigation', async () => {
    const fixture = createFixture({ contentReady: false });

    fixture.nav.nextSpread();

    expect(fixture.ensureSpread).toHaveBeenCalledOnce();
    expect(fixture.ensureSpread.mock.calls[0]?.[0]).toBe(1);
    expect(fixture.current()).toBe(0);
    expect(fixture.goToTarget).not.toHaveBeenCalled();

    fixture.commitSpread(1);
    fixture.growth(0).resolve(true);
    await settleTasks();

    expect(fixture.onPaginationChanged).toHaveBeenCalledOnce();
    expect(fixture.current()).toBe(0);
    expect(fixture.assignSlot).toHaveBeenCalledWith('next', 1);
    expect(fixture.goToTarget).not.toHaveBeenCalled();

    fixture.setContentReady(true);
    fixture.nav.notifyContentReady(1);

    expect(fixture.ensureSpread).toHaveBeenCalledOnce();
    expect(fixture.current()).toBe(1);
    expect(fixture.notifyActiveSpread).toHaveBeenCalledWith(1);
    expect(fixture.goToTarget).toHaveBeenCalledOnce();
    expect(fixture.goToTarget).toHaveBeenCalledWith('forward', 0, 1, 0);
  });

  it('treats false as the final boundary and does not grow it again', async () => {
    const fixture = createFixture();

    fixture.nav.nextSpread();
    const signal = fixture.growth(0).signal;
    fixture.setComplete(true);
    fixture.growth(0).resolve(false);
    await settleTasks();

    expect(signal.aborted).toBe(false);
    expect(fixture.current()).toBe(0);
    expect(fixture.assignSlot).not.toHaveBeenCalled();
    expect(fixture.notifyActiveSpread).not.toHaveBeenCalled();
    expect(fixture.goToTarget).not.toHaveBeenCalled();
    expect(fixture.onPaginationChanged).toHaveBeenCalledOnce();
    expect(fixture.onNavigationCancelled).toHaveBeenCalledOnce();

    fixture.nav.nextSpread();

    expect(fixture.ensureSpread).toHaveBeenCalledOnce();
    expect(fixture.onNavigationCancelled).toHaveBeenCalledTimes(2);
  });

  it('aborts a superseded request and ignores its late success and rejection', async () => {
    const fixture = createFixture();

    fixture.nav.nextSpread();
    const first = fixture.growth(0);
    fixture.nav.nextSpread();
    const second = fixture.growth(1);

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);

    first.resolve(true);
    await settleTasks();
    expect(fixture.onPaginationChanged).not.toHaveBeenCalled();
    expect(fixture.goToTarget).not.toHaveBeenCalled();

    fixture.commitSpread(1);
    second.resolve(true);
    await settleTasks();

    expect(fixture.current()).toBe(1);
    expect(fixture.onPaginationChanged).toHaveBeenCalledOnce();
    expect(fixture.goToTarget).toHaveBeenCalledOnce();

    const ignored = createFixture();
    ignored.nav.nextSpread();
    const stale = ignored.growth(0);
    ignored.nav.nextSpread();
    stale.reject(new Error('late stale failure'));
    await settleTasks();
    expect(ignored.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('aborts deferred gesture and disposal ownership without reviving late work', async () => {
    const fixture = createFixture();
    const onTransitionStart = vi.fn();
    const onUnavailable = vi.fn();

    const gesture = fixture.nav.startGestureNavigation(1, onTransitionStart, onUnavailable);
    const cancelled = fixture.growth(0);
    gesture.cancel();

    expect(cancelled.signal.aborted).toBe(true);
    expect(onUnavailable).toHaveBeenCalledOnce();
    cancelled.resolve(true);
    await settleTasks();
    expect(onTransitionStart).not.toHaveBeenCalled();
    expect(fixture.goToTarget).not.toHaveBeenCalled();

    fixture.nav.nextSpread();
    const disposed = fixture.growth(1);
    fixture.nav.dispose();
    expect(disposed.signal.aborted).toBe(true);
    disposed.reject(new Error('late disposed failure'));
    await settleTasks();
    expect(fixture.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('reports an owned growth failure without an unhandled navigation task', async () => {
    const fixture = createFixture();

    fixture.nav.nextSpread();
    fixture.growth(0).reject(new Error('growth failed'));
    await settleTasks();

    expect(fixture.current()).toBe(0);
    expect(fixture.onNavigationCancelled).toHaveBeenCalledOnce();
    expect(fixture.emit).toHaveBeenCalledWith('error', {
      message: 'growth failed',
      source: 'reader pagination',
    });
  });

  it('restores position ownership when an active growth request is cancelled', async () => {
    const fixture = createFixture();

    fixture.nav.nextSpread();
    fixture.growth(0).resolve(undefined);
    await settleTasks();

    expect(fixture.current()).toBe(0);
    expect(fixture.onPaginationChanged).not.toHaveBeenCalled();
    expect(fixture.onNavigationCancelled).toHaveBeenCalledOnce();
  });

  it('registers abort ownership before ensureSpread can synchronously reenter dispose', async () => {
    const fixture = createFixture();
    fixture.setEnsureHook(() => {
      fixture.nav.dispose();
    });

    fixture.nav.nextSpread();

    expect(fixture.growth(0).signal.aborted).toBe(true);
    fixture.nav.nextSpread();
    expect(fixture.ensureSpread).toHaveBeenCalledOnce();
    fixture.growth(0).resolve(true);
    await settleTasks();
    expect(fixture.goToTarget).not.toHaveBeenCalled();
  });

  it('preserves legacy no-op animation behavior without incremental pagination', () => {
    const fixture = createFixture({ animating: true, incremental: false });

    fixture.nav.nextSpread();

    expect(fixture.forceSettle).not.toHaveBeenCalled();
    expect(fixture.onNavigationCancelled).toHaveBeenCalledOnce();
  });

  it('rejects a final miss that was not atomically marked complete', async () => {
    const fixture = createFixture();

    fixture.nav.nextSpread();
    fixture.growth(0).resolve(false);
    await settleTasks();

    expect(fixture.onPaginationChanged).not.toHaveBeenCalled();
    expect(fixture.emit).toHaveBeenCalledWith('error', {
      message: 'Reader returned a final pagination miss before committing completion',
      source: 'reader pagination',
    });
  });

  it('contains errors thrown while committing a successful continuation', async () => {
    const fixture = createFixture();
    fixture.onPaginationChanged.mockImplementationOnce(() => {
      throw new Error('pagination listener failed');
    });

    fixture.nav.nextSpread();
    fixture.commitSpread(1);
    fixture.growth(0).resolve(true);
    await settleTasks();

    expect(fixture.onNavigationCancelled).toHaveBeenCalledOnce();
    expect(fixture.emit).toHaveBeenCalledWith('error', {
      message: 'pagination listener failed',
      source: 'reader pagination',
    });
  });

  it('settles a gesture that becomes a final no-op before navigation starts', () => {
    const fixture = createFixture();
    const onTransitionStart = vi.fn();
    const onUnavailable = vi.fn();
    fixture.setComplete(true);

    fixture.nav.startGestureNavigation(1, onTransitionStart, onUnavailable);

    expect(onTransitionStart).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledOnce();
  });
});

function createFixture(
  options: {
    readonly animating?: boolean;
    readonly contentReady?: boolean;
    readonly incremental?: boolean;
  } = {},
) {
  let currentSpread = 0;
  let totalSpreads = 1;
  let complete = false;
  let contentReady = options.contentReady ?? true;
  let ensureHook = (): void => undefined;
  const spreads: object[] = [{}];
  const growths: DeferredGrowth[] = [];
  const ensureSpread = vi.fn((_: number, signal?: AbortSignal) => {
    const deferred = createDeferredGrowth(signal ?? new AbortController().signal);
    growths.push(deferred);
    ensureHook();
    return deferred.promise;
  });
  const notifyActiveSpread = vi.fn();
  const pagination = {
    get complete() {
      return complete;
    },
    ensureSpread,
  };
  const reader = {
    get totalSpreads() {
      return totalSpreads;
    },
    get spreads() {
      return spreads;
    },
    ...(options.incremental === false ? {} : { pagination }),
    notifyActiveSpread,
  } as unknown as Reader;
  const goToTarget = vi.fn();
  const assignSlot = vi.fn();
  const emit = vi.fn();
  const onNavigationCancelled = vi.fn();
  const onPaginationChanged = vi.fn();
  const forceSettle = vi.fn(() => 0);
  const deps = {
    getReader: () => reader,
    getCurrentSpread: () => currentSpread,
    setCurrentSpread: (index: number) => {
      currentSpread = index;
    },
    getRenderScale: () => 1,
    emitter: { emit },
    td: {
      isAnimating: options.animating ?? false,
      viewportWidth: 800,
      goToTarget,
      forceSettle,
    },
    frameDriver: { scheduleComposite: vi.fn() },
    pool: {
      getSlotFor: vi.fn(() => null),
      assignSlot,
      ensureContent: vi.fn(() => contentReady),
    },
    contentRenderer: vi.fn(() => true),
    onNavigationIntent: vi.fn(),
    onNavigationCancelled,
    onPaginationChanged,
  } as unknown as NavigationDeps;
  return {
    nav: createNavigation(deps),
    ensureSpread,
    notifyActiveSpread,
    goToTarget,
    assignSlot,
    emit,
    onNavigationCancelled,
    onPaginationChanged,
    forceSettle,
    current: () => currentSpread,
    growth: (index: number) => requiredGrowth(growths, index),
    setContentReady(value: boolean) {
      contentReady = value;
    },
    setComplete(value: boolean) {
      complete = value;
    },
    setEnsureHook(hook: () => void) {
      ensureHook = hook;
    },
    commitSpread(index: number) {
      while (spreads.length <= index) spreads.push({});
      totalSpreads = spreads.length;
    },
  };
}

interface DeferredGrowth {
  readonly promise: Promise<boolean | undefined>;
  readonly signal: AbortSignal;
  readonly resolve: (value: boolean | undefined) => void;
  readonly reject: (error: unknown) => void;
}

function createDeferredGrowth(signal: AbortSignal): DeferredGrowth {
  let resolve = (_value: boolean | undefined): void => undefined;
  let reject = (_error: unknown): void => undefined;
  const promise = new Promise<boolean | undefined>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, signal, resolve, reject };
}

function requiredGrowth(growths: readonly DeferredGrowth[], index: number): DeferredGrowth {
  const growth = growths[index];
  if (!growth) throw new Error(`Missing growth request ${String(index)}`);
  return growth;
}

async function settleTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
