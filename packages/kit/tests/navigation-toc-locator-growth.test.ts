import { describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderLocator, ReaderLocatorResolution, TocEntry } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';

describe('partial locator navigation', () => {
  it('grows a generic internal-link locator through the same atomic owner', async () => {
    const fixture = createFixture();
    const locator = { href: 'chapter-4.xhtml', anchorId: 'target' };

    fixture.nav.navigateToLocator(locator);

    expect(fixture.navigateToLocator).toHaveBeenCalledWith(locator, expect.any(AbortSignal));
    fixture.commitExtent(4);
    fixture.request(0).resolve(resolvedLocator(locator.href, 3));
    await settleTasks();

    expect(fixture.current()).toBe(3);
    expect(fixture.onPaginationChanged).toHaveBeenCalledOnce();
    expect(fixture.goToTarget).toHaveBeenCalledWith('forward', 0, 3, 0);
  });

  it('reports an unresolved internal-link locator without pretending to navigate', async () => {
    const fixture = createFixture();

    fixture.nav.navigateToLocator({ href: 'missing.xhtml' });
    fixture.request(0).resolve({
      status: 'pending',
      locator: { href: 'missing.xhtml' },
      spineIdref: 'missing',
      reason: 'noPageProjection',
      matchedBy: 'href',
    });
    await settleTasks();

    expect(fixture.current()).toBe(0);
    expect(fixture.emit).toHaveBeenCalledWith('error', {
      message: 'Reader locator navigation did not resolve its link target',
      source: 'reader link locator navigation',
    });
  });

  it('grows an unresolved TOC href atomically and navigates its committed spread', async () => {
    const fixture = createFixture();

    fixture.nav.navigateToTocEntry(fixture.entry('chapter-3.xhtml'));

    expect(fixture.navigateToLocator).toHaveBeenCalledOnce();
    expect(fixture.navigateToLocator.mock.calls[0]?.[0]).toEqual({ href: 'chapter-3.xhtml' });
    expect(fixture.request(0).signal.aborted).toBe(false);
    expect(fixture.current()).toBe(0);

    fixture.commitExtent(3);
    fixture.request(0).resolve(resolvedLocator('chapter-3.xhtml', 2));
    await settleTasks();

    expect(fixture.current()).toBe(2);
    expect(fixture.onPaginationChanged).toHaveBeenCalledOnce();
    expect(fixture.notifyActiveSpread).toHaveBeenCalledWith(2);
    expect(fixture.goToTarget).toHaveBeenCalledWith('forward', 0, 2, 0);
  });

  it('uses latest-wins ownership and ignores an older locator completion', async () => {
    const fixture = createFixture();

    fixture.nav.navigateToTocEntry(fixture.entry('older.xhtml'));
    fixture.nav.navigateToTocEntry(fixture.entry('latest.xhtml'));

    expect(fixture.request(0).signal.aborted).toBe(true);
    expect(fixture.request(1).signal.aborted).toBe(false);

    fixture.commitExtent(2);
    fixture.request(0).resolve(resolvedLocator('older.xhtml', 1));
    await settleTasks();
    expect(fixture.current()).toBe(0);

    fixture.request(1).resolve(resolvedLocator('latest.xhtml', 1));
    await settleTasks();
    expect(fixture.current()).toBe(1);
    expect(fixture.goToTarget).toHaveBeenCalledOnce();
  });

  it('lets a selection input cancel pending locator growth without a late jump', async () => {
    const fixture = createFixture();
    const locator = { href: 'pending.xhtml' };

    fixture.nav.navigateToLocator(locator);
    const pending = fixture.request(0);
    const barrier = fixture.nav.supersedeForSelectionIntent();

    expect(barrier?.owns()).toBe(true);
    expect(pending.signal.aborted).toBe(true);
    expect(fixture.onNavigationCancelled).not.toHaveBeenCalled();

    fixture.commitExtent(2);
    pending.resolve(resolvedLocator(locator.href, 1));
    await settleTasks();

    expect(fixture.current()).toBe(0);
    expect(fixture.goToTarget).not.toHaveBeenCalled();
  });

  it('does not resume an old TOC target after pagination publication reenters navigation', async () => {
    const fixture = createFixture();
    fixture.onPaginationChanged.mockImplementationOnce(() => {
      fixture.nav.navigateToTocEntry(fixture.entry('latest.xhtml'));
    });

    fixture.nav.navigateToTocEntry(fixture.entry('older.xhtml'));
    fixture.commitExtent(2);
    fixture.request(0).resolve(resolvedLocator('older.xhtml', 1));
    await settleTasks();

    expect(fixture.current()).toBe(0);
    expect(fixture.navigateToLocator).toHaveBeenCalledTimes(2);
    expect(fixture.request(1).signal.aborted).toBe(false);
    expect(fixture.goToTarget).not.toHaveBeenCalled();
  });

  it('aborts locator ownership on disposal and contains a late rejection', async () => {
    const fixture = createFixture();

    fixture.nav.navigateToTocEntry(fixture.entry('chapter.xhtml'));
    const pending = fixture.request(0);
    fixture.nav.dispose();

    expect(pending.signal.aborted).toBe(true);
    pending.reject(new Error('late disposed locator failure'));
    await settleTasks();
    expect(fixture.emit).not.toHaveBeenCalledWith('error', expect.anything());
  });

  it('contains throwing failure listeners and releases locator ownership', async () => {
    const fixture = createFixture();
    fixture.emit.mockImplementationOnce(() => {
      throw new Error('error listener failed');
    });

    fixture.nav.navigateToTocEntry(fixture.entry('broken.xhtml'));
    fixture.request(0).reject(new Error('locator failed'));
    await settleTasks();

    fixture.nav.navigateToTocEntry(fixture.entry('retry.xhtml'));
    expect(fixture.navigateToLocator).toHaveBeenCalledTimes(2);
    expect(fixture.request(1).signal.aborted).toBe(false);
  });

  it('reports an owned locator protocol miss without navigating', async () => {
    const fixture = createFixture();

    fixture.nav.navigateToTocEntry(fixture.entry('chapter.xhtml'));
    fixture.request(0).resolve({
      status: 'pending',
      locator: { href: 'chapter.xhtml' },
      spineIdref: 'chapter',
      reason: 'noPageProjection',
      matchedBy: 'href',
    });
    await settleTasks();

    expect(fixture.current()).toBe(0);
    expect(fixture.emit).toHaveBeenCalledWith('error', {
      message: 'Reader locator navigation did not resolve its TOC target',
      source: 'reader TOC locator navigation',
    });
    expect(fixture.onNavigationCancelled).toHaveBeenCalledOnce();
  });

  it('restores position ownership when resolved navigation continuation throws', async () => {
    const fixture = createFixture();
    fixture.setContentFailure(new Error('slot failed'));

    fixture.nav.navigateToTocEntry(fixture.entry('chapter.xhtml'));
    fixture.commitExtent(2);
    fixture.request(0).resolve(resolvedLocator('chapter.xhtml', 1));
    await settleTasks();

    expect(fixture.onNavigationCancelled).toHaveBeenCalledOnce();
    expect(fixture.emit).toHaveBeenCalledWith('error', {
      message: 'slot failed',
      source: 'reader TOC locator navigation',
    });
  });

  it('preserves layout-driven retry behavior for legacy readers', () => {
    const fixture = createFixture({ locatorNavigation: false });
    const entry = fixture.entry('legacy.xhtml');

    fixture.nav.navigateToTocEntry(entry);
    expect(fixture.navigateToLocator).not.toHaveBeenCalled();
    expect(fixture.current()).toBe(0);

    fixture.resolveToc.mockReturnValue({ pageIndex: 1, spreadIndex: 1 });
    fixture.commitExtent(2);
    fixture.nav.notifyLayoutCommitted();

    expect(fixture.current()).toBe(1);
    expect(fixture.goToTarget).toHaveBeenCalledOnce();
  });
});

function createFixture(options: { readonly locatorNavigation?: boolean } = {}) {
  let currentSpread = 0;
  let totalSpreads = 1;
  const spreads: object[] = [{}];
  const requests: DeferredLocator[] = [];
  const navigateToLocator = vi.fn((_locator: ReaderLocator, signal?: AbortSignal) => {
    const request = deferredLocator(signal ?? new AbortController().signal);
    requests.push(request);
    return request.promise;
  });
  const resolveToc = vi.fn<Reader['resolveTocEntry']>(() => undefined);
  const notifyActiveSpread = vi.fn();
  const reader = {
    get totalSpreads() {
      return totalSpreads;
    },
    get spreads() {
      return spreads;
    },
    resolveTocEntry: resolveToc,
    notifyActiveSpread,
    ...(options.locatorNavigation === false ? {} : { navigateToLocator }),
  } as unknown as Reader;
  const goToTarget = vi.fn();
  const emit = vi.fn();
  const onNavigationCancelled = vi.fn();
  const onPaginationChanged = vi.fn();
  let contentFailure: Error | undefined;
  const deps = {
    getReader: () => reader,
    getCurrentSpread: () => currentSpread,
    setCurrentSpread: (index: number) => {
      currentSpread = index;
    },
    getRenderScale: () => 1,
    emitter: { emit },
    td: { isAnimating: false, viewportWidth: 800, forceSettle: vi.fn(), goToTarget },
    frameDriver: { scheduleComposite: vi.fn() },
    pool: {
      getSlotFor: vi.fn(() => null),
      assignSlot: vi.fn(),
      ensureContent: vi.fn(() => {
        if (contentFailure) throw contentFailure;
        return true;
      }),
    },
    contentRenderer: vi.fn(),
    onNavigationIntent: vi.fn(),
    onNavigationCancelled,
    onPaginationChanged,
  } as unknown as NavigationDeps;
  return {
    nav: createNavigation(deps),
    navigateToLocator,
    resolveToc,
    notifyActiveSpread,
    goToTarget,
    emit,
    onNavigationCancelled,
    onPaginationChanged,
    current: () => currentSpread,
    setContentFailure(error: Error) {
      contentFailure = error;
    },
    entry: (href: string): TocEntry => ({ label: href, href, children: [] }),
    request: (index: number) => requiredRequest(requests, index),
    commitExtent(lastSpread: number) {
      while (spreads.length <= lastSpread) spreads.push({});
      totalSpreads = spreads.length;
    },
  };
}

interface DeferredLocator {
  readonly promise: Promise<ReaderLocatorResolution | undefined>;
  readonly signal: AbortSignal;
  readonly resolve: (value: ReaderLocatorResolution | undefined) => void;
  readonly reject: (error: unknown) => void;
}

function deferredLocator(signal: AbortSignal): DeferredLocator {
  let resolve = (_value: ReaderLocatorResolution | undefined): void => undefined;
  let reject = (_error: unknown): void => undefined;
  const promise = new Promise<ReaderLocatorResolution | undefined>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, signal, resolve, reject };
}

function requiredRequest(requests: readonly DeferredLocator[], index: number): DeferredLocator {
  const request = requests[index];
  if (!request) throw new Error(`Missing locator request ${String(index)}`);
  return request;
}

function resolvedLocator(href: string, spreadIndex: number): ReaderLocatorResolution {
  return {
    status: 'resolved',
    locator: { href },
    spineIdref: href,
    pageIndex: spreadIndex,
    spreadIndex,
    matchedBy: 'href',
  };
}

async function settleTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
