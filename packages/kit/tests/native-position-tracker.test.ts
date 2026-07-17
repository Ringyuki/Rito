import { describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '@ritojs/core';
import type { PositionLocatorNavigator } from '../src/interaction/position/native';
import { createPositionTracker } from '../src/interaction/position/tracker';
import type { PositionLayout, ReadingPosition } from '../src/interaction/position/model';

const locator: ReaderLocator = {
  href: 'chapter.xhtml',
  sourcePoint: { nodePath: [0, 1], textOffset: 12 },
};

describe('native reading-position tracker', () => {
  it('captures the native source anchor asynchronously', async () => {
    const capture = deferred<unknown>();
    const getPageReadingAnchor = vi.fn(() => capture.promise);
    const tracker = createTracker({ getPageReadingAnchor, resolveLocator: vi.fn() });
    const changes: ReadingPosition[] = [];
    tracker.onPositionChange((position) => changes.push(position));

    tracker.update(1);
    expect(getPageReadingAnchor).toHaveBeenCalledWith(1);
    expect(tracker.getCurrent()).toBeNull();

    capture.resolve({
      status: 'resolved',
      pageIndex: 1,
      spreadIndex: 1,
      locator,
    });
    await tracker.settle();

    expect(changes).toHaveLength(1);
    expect(tracker.getCurrent()).toMatchObject({
      sourceLocator: locator,
      projection: { pageIndex: 1, spreadIndex: 1 },
      progress: 0.5,
    });
  });

  it('publishes a pending native anchor against the latest appended pagination', async () => {
    const capture = deferred<unknown>();
    const initialLayout = layout();
    let currentLayout = initialLayout;
    const tracker = createTracker(
      {
        getPageReadingAnchor: vi.fn(() => capture.promise),
        resolveLocator: vi.fn(),
      },
      () => currentLayout,
    );

    tracker.update(1);
    currentLayout = appendedLayout(initialLayout);
    capture.resolve({ status: 'resolved', pageIndex: 1, spreadIndex: 1, locator });
    await tracker.settle();

    expect(tracker.getCurrent()).toMatchObject({
      projection: { pageIndex: 1, spreadIndex: 1 },
      progress: 0.25,
    });
  });

  it('settles the latest capture when an anchor lookup synchronously reenters', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    let reentered = false;
    const getPageReadingAnchor = vi.fn(() => {
      if (!reentered) {
        reentered = true;
        tracker.update(1);
        return first.promise;
      }
      return second.promise;
    });
    const tracker = createTracker({ getPageReadingAnchor, resolveLocator: vi.fn() });

    tracker.update(0);
    const settlement = tracker.settle();
    let settled = false;
    void settlement.then(() => {
      settled = true;
    });
    first.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, locator });
    await settleMicrotasks();
    expect(settled).toBe(false);

    second.resolve({ status: 'resolved', pageIndex: 1, spreadIndex: 1, locator });
    await settlement;
    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 1, spreadIndex: 1 });
  });

  it('does not re-query a pending or committed native anchor for a same-spread repaint', async () => {
    const capture = deferred<unknown>();
    const getPageReadingAnchor = vi.fn(() => capture.promise);
    const tracker = createTracker({ getPageReadingAnchor, resolveLocator: vi.fn() });

    tracker.update(1);
    tracker.update(1);
    expect(getPageReadingAnchor).toHaveBeenCalledOnce();

    capture.resolve({ status: 'resolved', pageIndex: 1, spreadIndex: 1, locator });
    await tracker.settle();
    tracker.update(1);
    expect(getPageReadingAnchor).toHaveBeenCalledOnce();
  });

  it('hides a stale current position from layout preservation after a new intent starts', async () => {
    const tracker = createTracker({
      getPageReadingAnchor: vi.fn(() =>
        Promise.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, locator }),
      ),
      resolveLocator: vi.fn(),
    });
    tracker.update(0);
    await tracker.settle();
    expect(tracker.getPreservableCurrent()).not.toBeNull();

    tracker.claimIntent();

    expect(tracker.getCurrent()).not.toBeNull();
    expect(tracker.getPreservableCurrent()).toBeNull();
  });

  it('continues across explicit unavailable pages and captures the next page in reading order', async () => {
    const getPageReadingAnchor = vi.fn((pageIndex: number) =>
      Promise.resolve(
        pageIndex === 0
          ? {
              status: 'unavailable',
              pageIndex: 0,
              spreadIndex: 0,
              reason: 'noSourceContent',
            }
          : { status: 'resolved', pageIndex: 1, spreadIndex: 0, locator },
      ),
    );
    const tracker = createTracker({ getPageReadingAnchor, resolveLocator: vi.fn() }, doubleLayout);

    tracker.update(0);
    await tracker.settle();

    expect(getPageReadingAnchor.mock.calls.map(([pageIndex]) => pageIndex)).toEqual([0, 1]);
    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 1, spreadIndex: 0 });
  });

  it('stops a multi-page capture conservatively when an anchor read is stale', async () => {
    const getPageReadingAnchor = vi.fn(() => Promise.resolve(undefined));
    const tracker = createTracker({ getPageReadingAnchor, resolveLocator: vi.fn() }, doubleLayout);

    tracker.update(0);
    await tracker.settle();

    expect(getPageReadingAnchor).toHaveBeenCalledOnce();
    expect(tracker.getCurrent()).toBeNull();
  });

  it.each([
    undefined,
    {
      status: 'unavailable',
      pageIndex: 1,
      spreadIndex: 1,
      reason: 'noSourceContent',
    },
  ])('does not approximate a native capture when the result is %j', async (result) => {
    const tracker = createTracker({
      getPageReadingAnchor: vi.fn(() => Promise.resolve(result)),
      resolveLocator: vi.fn(),
    });

    tracker.update(1);
    await tracker.settle();

    expect(tracker.getCurrent()).toBeNull();
    expect(tracker.serialize()).toBeUndefined();
  });

  it('does not let an older capture overwrite explicit navigation', async () => {
    const capture = deferred<unknown>();
    const resolution = deferred<unknown>();
    const resolveLocator = vi.fn(() => resolution.promise);
    const tracker = createTracker({
      getPageReadingAnchor: vi.fn(() => capture.promise),
      resolveLocator,
    });
    const target = position(locator);

    tracker.update(0);
    const navigation = tracker.resolveForNavigation(target);
    expect(resolveLocator).toHaveBeenCalledWith(locator);

    capture.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, locator });
    resolution.resolve({
      status: 'resolved',
      locator,
      spineIdref: 'chapter',
      pageIndex: 1,
      spreadIndex: 1,
      matchedBy: 'sourcePoint',
    });

    const projected = await navigation;
    expect(tracker.getCurrent()).toBeNull();
    expect(projected).toMatchObject({
      position: {
        sourceLocator: locator,
        projection: { pageIndex: 1, spreadIndex: 1 },
      },
    });
    if (projected) tracker.commit(projected.intent, projected.position);
    expect(tracker.getCurrent()).toEqual(projected?.position);
  });

  it('rejects a restore commit superseded synchronously by a position listener', async () => {
    const tracker = createTracker({
      getPageReadingAnchor: vi.fn(),
      resolveLocator: vi.fn(() => Promise.resolve(resolvedLocator(1, 1))),
    });
    tracker.onPositionChange(() => {
      tracker.claimIntent();
    });
    const intent = tracker.claimPortableIntent();

    await expect(
      tracker.restore(JSON.stringify(position(locator)), intent),
    ).resolves.toBeUndefined();
    expect(tracker.getPreservableCurrent()).toBeNull();
  });

  it('projects an old archive through the legacy locator when native source identity is absent', async () => {
    const resolveLocator = vi.fn(() =>
      Promise.resolve({
        status: 'resolved',
        locator: { href: 'chapter.xhtml', progression: 1 },
        spineIdref: 'chapter',
        pageIndex: 1,
        spreadIndex: 1,
        matchedBy: 'progression',
      }),
    );
    const tracker = createTracker({
      getPageReadingAnchor: vi.fn(),
      resolveLocator,
    });

    await expect(tracker.resolveForNavigation(legacyPosition())).resolves.toMatchObject({
      position: {
        sourceLocator: { href: 'chapter.xhtml', progression: 1 },
        projection: { pageIndex: 1, spreadIndex: 1 },
      },
    });
    expect(resolveLocator).toHaveBeenCalledWith({ href: 'chapter.xhtml', progression: 1 });
  });

  it('waits for a not-paginated locator and retries it after the full layout commits', async () => {
    const resolveLocator = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'pending',
        locator,
        spineIdref: 'chapter',
        reason: 'notPaginated',
        matchedBy: 'sourcePoint',
      })
      .mockResolvedValueOnce(resolvedLocator(1, 1));
    const tracker = createTracker({ getPageReadingAnchor: vi.fn(), resolveLocator });
    const intent = tracker.claimPortableIntent();
    const restoring = tracker.restore(JSON.stringify(position(locator)), intent);
    await Promise.resolve();

    expect(tracker.getPreservableCurrent()).toBeNull();
    expect(tracker.prepareLayoutCommit(undefined, 1)).toEqual({ kind: 'portable' });
    await expect(restoring).resolves.toBe(1);
    expect(resolveLocator).toHaveBeenCalledTimes(2);
    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 1, spreadIndex: 1 });
  });

  it('carries a distant legacy archive through preview into the full native layout', async () => {
    const resolveLocator = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'pending',
        locator: { href: 'chapter.xhtml', progression: 1 },
        spineIdref: 'chapter',
        reason: 'notPaginated',
        matchedBy: 'progression',
      })
      .mockResolvedValueOnce({
        ...resolvedLocator(1, 1),
        locator: { href: 'chapter.xhtml', progression: 1 },
        matchedBy: 'progression',
      });
    const tracker = createTracker({ getPageReadingAnchor: vi.fn(), resolveLocator });
    const intent = tracker.claimPortableIntent();
    const restoring = tracker.restore(JSON.stringify(legacyPosition()), intent);
    await Promise.resolve();

    tracker.prepareLayoutCommit(undefined, 1);

    await expect(restoring).resolves.toBe(1);
    expect(resolveLocator).toHaveBeenNthCalledWith(1, {
      href: 'chapter.xhtml',
      progression: 1,
    });
    expect(tracker.getCurrent()?.sourceLocator).toEqual({
      href: 'chapter.xhtml',
      progression: 1,
    });
  });

  it('awaits atomic locator navigation without restarting it on layout commits', async () => {
    const pending = deferred<ReturnType<typeof resolvedLocator>>();
    const resolveLocator = vi.fn();
    const signals: AbortSignal[] = [];
    const navigateToLocator = vi.fn((_locator: ReaderLocator, signal: AbortSignal) => {
      signals.push(signal);
      return pending.promise;
    });
    const tracker = createPositionTracker(
      layout,
      () =>
        ({
          enabled: true,
          getPageReadingAnchor: vi.fn(),
          resolveLocator,
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
      navigateToLocator,
    );
    const intent = tracker.claimPortableIntent();
    const resolving = tracker.resolveForNavigation(position(locator), intent);

    expect(tracker.prepareLayoutCommit(undefined, 1)).toEqual({ kind: 'portable' });
    expect(tracker.prepareLayoutCommit(undefined, 1)).toEqual({ kind: 'portable' });
    expect(navigateToLocator).toHaveBeenCalledOnce();
    expect(resolveLocator).not.toHaveBeenCalled();
    expect(signals[0]?.aborted).toBe(false);

    pending.resolve(resolvedLocator(1, 1));
    await expect(resolving).resolves.toMatchObject({
      intent,
      position: { projection: { pageIndex: 1, spreadIndex: 1 } },
    });
  });

  it('aborts an older atomic locator when a newer intent takes ownership', async () => {
    const first = deferred<ReturnType<typeof resolvedLocator>>();
    const second = deferred<ReturnType<typeof resolvedLocator>>();
    const signals: AbortSignal[] = [];
    const navigateToLocator = vi.fn((_locator: ReaderLocator, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const tracker = createPositionTracker(layout, () => undefined, navigateToLocator);

    const older = tracker.resolveForNavigation(position(locator));
    const newer = tracker.resolveForNavigation(position({ ...locator, progression: 0.8 }));

    expect(signals[0]?.aborted).toBe(true);
    first.reject(new Error('late aborted failure'));
    await expect(older).resolves.toBeUndefined();

    second.resolve(resolvedLocator(1, 1));
    await expect(newer).resolves.toMatchObject({
      position: { projection: { pageIndex: 1, spreadIndex: 1 } },
    });
    expect(signals[1]?.aborted).toBe(false);
  });

  it('settles the latest locator when navigator entry synchronously reenters', async () => {
    const stale = deferred<ReturnType<typeof resolvedLocator>>();
    const latest = deferred<ReturnType<typeof resolvedLocator>>();
    let reentered = false;
    let latestResolution: ReturnType<typeof tracker.resolveForNavigation> | undefined;
    const navigateToLocator = vi.fn<PositionLocatorNavigator>(() => {
      if (!reentered) {
        reentered = true;
        const intent = tracker.claimPortableIntent();
        latestResolution = tracker.resolveForNavigation(position(locator), intent);
        return stale.promise;
      }
      return latest.promise;
    });
    const tracker = createPositionTracker(layout, () => undefined, navigateToLocator);
    const staleIntent = tracker.claimPortableIntent();

    const staleResolution = tracker.resolveForNavigation(position(locator), staleIntent);
    const settlement = tracker.settle();
    let settled = false;
    void settlement.then(() => {
      settled = true;
    });
    stale.resolve(resolvedLocator(0, 0));
    await settleMicrotasks();
    expect(settled).toBe(false);

    latest.resolve(resolvedLocator(1, 1));
    await settlement;
    await expect(staleResolution).resolves.toBeUndefined();
    await expect(latestResolution).resolves.toMatchObject({
      position: { projection: { pageIndex: 1, spreadIndex: 1 } },
    });
  });

  it('settles after abort even when the atomic navigator ignores its signal', async () => {
    const pending = deferred<ReturnType<typeof resolvedLocator>>();
    let signal: AbortSignal | undefined;
    const tracker = createPositionTracker(
      layout,
      () => undefined,
      (_locator, nextSignal) => {
        signal = nextSignal;
        return pending.promise;
      },
    );
    const resolving = tracker.resolveForNavigation(position(locator));

    tracker.claimIntent();
    expect(signal?.aborted).toBe(true);

    await expect(resolving).resolves.toBeUndefined();
    expect(tracker.getCurrent()).toBeNull();

    pending.reject(new Error('late ignored-abort failure'));
    await Promise.resolve();
  });

  it('aborts atomic locator navigation when the tracker is disposed', async () => {
    const pending = deferred<ReturnType<typeof resolvedLocator>>();
    let signal: AbortSignal | undefined;
    const tracker = createPositionTracker(
      layout,
      () => undefined,
      (_locator, nextSignal) => {
        signal = nextSignal;
        return pending.promise;
      },
    );
    const resolving = tracker.resolveForNavigation(position(locator));

    tracker.dispose();

    expect(signal?.aborted).toBe(true);
    pending.reject(new Error('late disposed failure'));
    await expect(resolving).resolves.toBeUndefined();
  });

  it('keeps layout projection on the read-only resolver when atomic navigation exists', async () => {
    const resolveLocator = vi.fn(() => Promise.resolve(resolvedLocator(1, 1)));
    const navigateToLocator = vi.fn();
    const tracker = createPositionTracker(
      layout,
      () =>
        ({
          enabled: true,
          getPageReadingAnchor: vi.fn(() =>
            Promise.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, locator }),
          ),
          resolveLocator,
          getPageTargets: vi.fn(),
          getFootnote: vi.fn(),
        }) as never,
      navigateToLocator,
    );
    tracker.update(0);
    await tracker.settle();

    expect(tracker.prepareLayoutCommit(undefined, 0)).toEqual({ kind: 'portable' });
    await tracker.settle();

    expect(resolveLocator).toHaveBeenCalledOnce();
    expect(navigateToLocator).not.toHaveBeenCalled();
  });

  it('terminates no-page-projection without waiting for another layout', async () => {
    const resolveLocator = vi.fn(() =>
      Promise.resolve({
        status: 'pending',
        locator,
        spineIdref: 'chapter',
        reason: 'noPageProjection',
        matchedBy: 'sourcePoint',
      }),
    );
    const tracker = createTracker({ getPageReadingAnchor: vi.fn(), resolveLocator });

    await expect(tracker.resolveForNavigation(position(locator))).resolves.toBeUndefined();
    expect(resolveLocator).toHaveBeenCalledOnce();
  });

  it('wakes a pending portable resolution when a newer navigation claims ownership', async () => {
    const resolveLocator = vi.fn(() =>
      Promise.resolve({
        status: 'pending',
        locator,
        spineIdref: 'chapter',
        reason: 'notPaginated',
        matchedBy: 'sourcePoint',
      }),
    );
    const tracker = createTracker({ getPageReadingAnchor: vi.fn(), resolveLocator });
    const resolving = tracker.resolveForNavigation(position(locator));
    await Promise.resolve();

    tracker.claimIntent();

    await expect(resolving).resolves.toBeUndefined();
    expect(tracker.serialize()).toBeUndefined();
  });

  it('ignores a legacy locator rejection superseded in the same tick', async () => {
    const pending = deferred<unknown>();
    const tracker = createTracker({
      getPageReadingAnchor: vi.fn(),
      resolveLocator: vi.fn(() => pending.promise),
    });
    const resolving = tracker.resolveForNavigation(position(locator));

    pending.reject(new Error('late legacy resolver failure'));
    tracker.claimIntent();

    await expect(resolving).resolves.toBeUndefined();
    expect(tracker.getCurrent()).toBeNull();
  });

  it('ends an in-flight portable resolution when disposed', async () => {
    const unresolved = deferred<unknown>();
    const tracker = createTracker({
      getPageReadingAnchor: vi.fn(),
      resolveLocator: vi.fn(() => unresolved.promise),
    });
    const resolving = tracker.resolveForNavigation(position(locator));

    tracker.dispose();

    await expect(resolving).resolves.toBeUndefined();
  });

  it('publishes the exact right-page projection after a full layout commit', async () => {
    const resolveLocator = vi.fn(() => Promise.resolve(resolvedLocator(1, 0)));
    const tracker = createTracker(
      {
        getPageReadingAnchor: vi.fn(() =>
          Promise.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, locator }),
        ),
        resolveLocator,
      },
      doubleLayout,
    );
    tracker.update(0);
    await tracker.settle();

    expect(tracker.prepareLayoutCommit(undefined, 0)).toEqual({ kind: 'portable' });
    await tracker.settle();

    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 1, spreadIndex: 0 });
  });

  it('rejects a malformed persisted source locator before calling the native resolver', async () => {
    const resolveLocator = vi.fn();
    const tracker = createTracker({
      getPageReadingAnchor: vi.fn(),
      resolveLocator,
    });
    const malformed = JSON.stringify({
      ...position(),
      sourceLocator: {
        href: 'chapter.xhtml',
        sourcePoint: { nodePath: [-1], textOffset: 0 },
      },
    });

    await expect(tracker.restore(malformed)).resolves.toBeUndefined();
    expect(resolveLocator).not.toHaveBeenCalled();
  });

  it.each([
    { progress: -0.1, timestamp: 1 },
    { progress: 0.5, timestamp: -1 },
    { progress: 2, timestamp: 1 },
  ])('rejects malformed persisted progress metadata %j', async (metadata) => {
    const resolveLocator = vi.fn();
    const tracker = createTracker({ getPageReadingAnchor: vi.fn(), resolveLocator });
    const malformed = JSON.stringify({ ...position(locator), ...metadata });

    await expect(tracker.restore(malformed)).resolves.toBeUndefined();
    expect(resolveLocator).not.toHaveBeenCalled();
  });

  it('drops a pending capture after invalidation or disposal', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const getPageReadingAnchor = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const tracker = createTracker({ getPageReadingAnchor, resolveLocator: vi.fn() });

    tracker.update(0);
    tracker.invalidate();
    first.resolve({ status: 'resolved', pageIndex: 0, spreadIndex: 0, locator });
    await Promise.resolve();
    expect(tracker.getCurrent()).toBeNull();

    tracker.update(1);
    tracker.dispose();
    second.resolve({ status: 'resolved', pageIndex: 1, spreadIndex: 1, locator });
    await Promise.resolve();
    expect(tracker.getCurrent()).toBeNull();
  });

  it('keeps the synchronous legacy capture and projection path without the capability', async () => {
    const tracker = createPositionTracker(() => layout());
    tracker.update(1);

    expect(tracker.getCurrent()?.projection).toEqual({ pageIndex: 1, spreadIndex: 1 });
    await expect(tracker.resolveForNavigation(position())).resolves.toMatchObject({
      position: { projection: { pageIndex: 0, spreadIndex: 0 } },
    });
  });
});

function createTracker(
  interactions: {
    readonly getPageReadingAnchor: ReturnType<typeof vi.fn>;
    readonly resolveLocator: ReturnType<typeof vi.fn>;
  },
  getLayout: () => PositionLayout = layout,
) {
  return createPositionTracker(
    getLayout,
    () =>
      ({
        enabled: true,
        getPageReadingAnchor: interactions.getPageReadingAnchor,
        resolveLocator: interactions.resolveLocator,
        getPageTargets: vi.fn(),
        getFootnote: vi.fn(),
      }) as never,
  );
}

function layout(): PositionLayout {
  const pages = [
    { index: 0, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: [] },
    { index: 1, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: [] },
  ] as const;
  return {
    pages,
    spreads: [
      { index: 0, left: pages[0] },
      { index: 1, left: pages[1] },
    ],
    chapterMap: new Map([['chapter', { startPage: 0, endPage: 1 }]]),
    manifestHrefMap: new Map([['chapter', 'chapter.xhtml']]),
  };
}

function doubleLayout(): PositionLayout {
  const base = layout();
  const left = base.pages[0];
  const right = base.pages[1];
  if (!left || !right) throw new Error('double-page test layout is incomplete');
  return {
    ...base,
    spreads: [{ index: 0, left, right }],
  };
}

function appendedLayout(base: PositionLayout): PositionLayout {
  const template = base.pages[0];
  if (!template) throw new Error('appended test layout is missing its template page');
  const third = { ...template, index: 2 };
  const fourth = { ...template, index: 3 };
  return {
    ...base,
    pages: [...base.pages, third, fourth],
    spreads: [...base.spreads, { index: 2, left: third }, { index: 3, left: fourth }],
    chapterMap: new Map([['chapter', { startPage: 0, endPage: 3 }]]),
  };
}

function position(sourceLocator?: ReaderLocator): ReadingPosition {
  return {
    ...(sourceLocator ? { sourceLocator } : {}),
    projection: { spreadIndex: 0, pageIndex: 0 },
    progress: 0,
    timestamp: 1,
  };
}

function legacyPosition(): ReadingPosition {
  return {
    ...position(),
    locator: { spineIdref: 'chapter', chapterProgress: 1 },
  };
}

function resolvedLocator(pageIndex: number, spreadIndex: number) {
  return {
    status: 'resolved',
    locator,
    spineIdref: 'chapter',
    pageIndex,
    spreadIndex,
    matchedBy: 'sourcePoint',
  } as const;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
