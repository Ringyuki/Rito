import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '../../src/reader';
import type {
  BrowserReaderRevisionResult,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import { notifySpreadRendered } from '../../src/bindings/browser/rendering';
import { buildBrowserReaderMethods } from '../../src/bindings/browser/reader/reader-methods';
import {
  navigateBrowserReaderToLocator,
  scheduleBrowserReaderReflow,
} from '../../src/bindings/browser/reader/pipeline/reflow';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  BASE_READER_OPTIONS,
  createDeferred,
  createState,
  createWorker,
  flushPromises,
  frameBuffer,
  revisionResult,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

type LocatorRead = Awaited<ReturnType<BrowserReaderWorkerClient['resolveSourceLocatorAtRevision']>>;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Browser reader atomic locator navigation', () => {
  it('returns an existing projection without reflow and owns locator copies', async () => {
    const fixture = createWorker(() => undefined);
    const state = readyState(fixture.worker);
    const inputPath = [0, 1];
    const input: ReaderLocator = {
      href: 'Text/chapter.xhtml',
      sourcePoint: { nodePath: inputPath, textOffset: 12 },
    };
    const nativeLocator = locator(12);
    fixture.resolveSourceLocatorAtRevision.mockResolvedValue(
      resolvedRead('rev-ready', nativeLocator, 2, 2),
    );

    const task = navigateBrowserReaderToLocator(state, input);
    inputPath.push(99);
    const result = await task;
    nativeLocator.sourcePoint.nodePath.push(77);

    expect(result).toEqual({
      status: 'resolved',
      locator: locator(12),
      spineIdref: 'chapter',
      pageIndex: 2,
      spreadIndex: 2,
      matchedBy: 'sourcePoint',
    });
    expect(fixture.resolveSourceLocatorAtRevision).toHaveBeenCalledWith(handle('rev-ready'), {
      href: 'Text/chapter.xhtml',
      sourcePoint: { nodePath: [0, 1], textOffset: 12 },
    });
    expect(fixture.createViewRevision).not.toHaveBeenCalled();
  });

  it('takes over deferred preview work with one full-only external-locator commit', async () => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const previewProducer = createWorker(() => undefined, 'preview-producer');
    const state = readyState(fixture.worker);
    const requested = locator(18);
    const exact = createDeferred<LocatorRead>();
    fixture.resolveSourceLocatorAtRevision.mockReturnValueOnce(exact.promise);
    attachDeferredPreview(state, previewProducer.worker);
    const committedSpreads: number[] = [];
    state.layoutCommittedListeners.add((spreadIndex) => committedSpreads.push(spreadIndex));

    const task = navigateBrowserReaderToLocator(state, requested);
    requested.sourcePoint.nodePath.push(88);
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);

    expect(state.reflow.deferred).toBeUndefined();
    expect(state.reflow.deferredTimer).toBeUndefined();
    expect(fixture.getPageReadingAnchorAtRevision).not.toHaveBeenCalled();
    expect(fixture.createViewRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'full',
        activeSpreadIndex: 0,
        preserveLocator: locator(18),
      }),
    );
    expect(fixture.createViewRevision.mock.lastCall?.[0].layoutConfig.viewportWidth).toBe(900);

    let settled = false;
    void task.then(() => {
      settled = true;
    });
    pending[0]?.resolve(revisionWithSelectedSpread('rev-full', 3));
    await settleUntil(() => state.revisionBundle.revision.revisionId === 'rev-full');

    expect(state.activeSpreadIndex).toBe(3);
    expect(committedSpreads).toEqual([3]);
    expect(settled).toBe(false);
    expect(previewProducer.releaseRevision).toHaveBeenCalledWith('rev-preview');

    exact.resolve(resolvedRead('rev-full', locator(18), 3, 3));
    await expect(task).resolves.toMatchObject({
      status: 'resolved',
      pageIndex: 3,
      spreadIndex: 3,
    });
    expect(settled).toBe(true);
  });

  it('lets the latest locator replace an in-flight background full revision', async () => {
    vi.stubGlobal('Worker', function Worker() {});
    const foregroundPending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const backgroundPending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const foreground = createWorker((deferred) => foregroundPending.push(deferred), 'foreground');
    const background = createWorker((deferred) => backgroundPending.push(deferred), 'background');
    const state = readyState(foreground.worker);
    state.fullReflowWorker = background.worker;
    state.fullReflowOpenPromise = Promise.resolve();
    const first = locator(10);
    const latest = locator(80);
    foreground.resolveSourceLocatorAtRevision.mockResolvedValueOnce(
      pendingRead('rev-ready', first),
    );
    background.resolveSourceLocatorAtRevision.mockResolvedValue(
      resolvedRead('rev-latest', latest, 4, 4),
    );

    const firstTask = navigateBrowserReaderToLocator(state, first);
    await settleUntil(() => background.createViewRevision.mock.calls.length === 1);
    const latestTask = navigateBrowserReaderToLocator(state, latest);

    await expect(firstTask).resolves.toBeUndefined();
    backgroundPending[0]?.resolve(revisionResult('rev-stale-first', 5, 5));
    await settleUntil(() => background.createViewRevision.mock.calls.length === 2);

    expect(background.releaseRevision).toHaveBeenCalledWith('rev-stale-first');
    expect(foreground.releaseRevision).not.toHaveBeenCalledWith('rev-stale-first');
    expect(background.createViewRevision.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ mode: 'full', preserveLocator: latest }),
    );

    backgroundPending[1]?.resolve(revisionWithSelectedSpread('rev-latest', 4));
    await expect(latestTask).resolves.toMatchObject({
      status: 'resolved',
      pageIndex: 4,
      spreadIndex: 4,
    });
    expect(state.worker).toBe(background.worker);
    expect(state.revisionBundle.revision.revisionId).toBe('rev-latest');
    expect(foregroundPending).toHaveLength(0);
  });

  it('carries a pending locator onto the newest layout policy', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const requested = locator(25);
    fixture.resolveSourceLocatorAtRevision
      .mockResolvedValueOnce(pendingRead('rev-ready', requested))
      .mockResolvedValueOnce(resolvedRead('rev-latest-layout', requested, 2, 2));

    const task = navigateBrowserReaderToLocator(state, requested);
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    expect(
      scheduleBrowserReaderReflow(
        state,
        { ...BASE_READER_OPTIONS, width: 1000 },
        'single',
        'greedy',
      ),
    ).toBe(true);

    pending[0]?.resolve(revisionResult('rev-stale-layout', 5, 5));
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 2);

    expect(fixture.releaseRevision).toHaveBeenCalledWith('rev-stale-layout');
    expect(fixture.createViewRevision.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ mode: 'full', preserveLocator: requested }),
    );
    expect(fixture.createViewRevision.mock.lastCall?.[0].layoutConfig.viewportWidth).toBe(1000);

    pending[1]?.resolve(revisionWithSelectedSpread('rev-latest-layout', 2));
    await expect(task).resolves.toMatchObject({ status: 'resolved', spreadIndex: 2 });
    expect(state.config.viewportWidth).toBe(1000);
  });

  it('takes ownership before an already-dispatched layout can commit', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const requested = locator(35);
    const committedSpreads: number[] = [];
    state.layoutCommittedListeners.add((spreadIndex) => committedSpreads.push(spreadIndex));
    fixture.resolveSourceLocatorAtRevision.mockResolvedValue(
      resolvedRead('rev-navigation', requested, 3, 3),
    );

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    const task = navigateBrowserReaderToLocator(state, requested);

    expect(fixture.resolveSourceLocatorAtRevision).not.toHaveBeenCalled();
    pending[0]?.resolve(revisionResult('rev-old-layout', 5, 5));
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 2);

    expect(state.revisionBundle.revision.revisionId).toBe('rev-ready');
    expect(committedSpreads).toEqual([]);
    expect(fixture.releaseRevision).toHaveBeenCalledWith('rev-old-layout');
    expect(fixture.createViewRevision.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ mode: 'full', preserveLocator: requested }),
    );

    pending[1]?.resolve(revisionWithSelectedSpread('rev-navigation', 3));
    await expect(task).resolves.toMatchObject({ status: 'resolved', spreadIndex: 3 });
    expect(committedSpreads).toEqual([3]);
  });

  it('upgrades an idle probe when a new layout arrives before it settles', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const requested = locator(45);
    const probe = createDeferred<LocatorRead>();
    fixture.resolveSourceLocatorAtRevision
      .mockReturnValueOnce(probe.promise)
      .mockResolvedValueOnce(resolvedRead('rev-probe-layout', requested, 4, 4));

    const task = navigateBrowserReaderToLocator(state, requested);
    expect(
      scheduleBrowserReaderReflow(
        state,
        { ...BASE_READER_OPTIONS, width: 1000 },
        'single',
        'greedy',
      ),
    ).toBe(true);
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);

    expect(fixture.createViewRevision.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        mode: 'full',
        preserveLocator: requested,
      }),
    );
    expect(fixture.createViewRevision.mock.lastCall?.[0].layoutConfig.viewportWidth).toBe(1000);
    let settled = false;
    void task.then(() => {
      settled = true;
    });
    probe.resolve(resolvedRead('rev-ready', requested, 1, 1));
    await flushPromises();
    expect(settled).toBe(false);

    pending[0]?.resolve(revisionWithSelectedSpread('rev-probe-layout', 4));
    await expect(task).resolves.toMatchObject({ status: 'resolved', spreadIndex: 4 });
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores an old probe that %ss after the inherited full commit',
    async (outcome) => {
      const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
      const fixture = createWorker((deferred) => pending.push(deferred));
      const state = readyState(fixture.worker);
      const requested = locator(46);
      const probe = createDeferred<LocatorRead>();
      const exact = createDeferred<LocatorRead>();
      fixture.resolveSourceLocatorAtRevision
        .mockReturnValueOnce(probe.promise)
        .mockReturnValueOnce(exact.promise);

      const task = navigateBrowserReaderToLocator(state, requested);
      scheduleBrowserReaderReflow(
        state,
        { ...BASE_READER_OPTIONS, width: 1000 },
        'single',
        'greedy',
      );
      await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
      pending[0]?.resolve(revisionWithSelectedSpread('rev-inherited', 4));
      await settleUntil(() => fixture.resolveSourceLocatorAtRevision.mock.calls.length === 2);

      if (outcome === 'resolve') probe.resolve(resolvedRead('rev-ready', requested, 1, 1));
      else probe.reject(new Error('late inherited probe failure'));
      await flushPromises();
      expect(state.reflow.lastError).toBeUndefined();
      expect(state.logger.error).not.toHaveBeenCalled();

      exact.resolve(resolvedRead('rev-inherited', requested, 4, 4));
      await expect(task).resolves.toMatchObject({ status: 'resolved', spreadIndex: 4 });
      expect(fixture.createViewRevision).toHaveBeenCalledOnce();
    },
  );

  it('does not let a pre-aborted replacement cancel the active locator', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const first = locator(47);
    fixture.resolveSourceLocatorAtRevision
      .mockResolvedValueOnce(pendingRead('rev-ready', first))
      .mockResolvedValueOnce(resolvedRead('rev-first', first, 4, 4));

    const firstTask = navigateBrowserReaderToLocator(state, first);
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    const active = state.reflow.locatorNavigation;
    const token = state.reflow.token;
    const controller = new AbortController();
    controller.abort();

    await expect(
      navigateBrowserReaderToLocator(state, locator(90), controller.signal),
    ).resolves.toBeUndefined();
    expect(state.reflow.locatorNavigation).toBe(active);
    expect(state.reflow.token).toBe(token);

    pending[0]?.resolve(revisionWithSelectedSpread('rev-first', 4));
    await expect(firstTask).resolves.toMatchObject({ status: 'resolved', spreadIndex: 4 });
    expect(fixture.createViewRevision).toHaveBeenCalledOnce();
  });

  it('probes a reentrant layout-commit navigation without another full revision', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const requested = locator(48);
    fixture.resolveSourceLocatorAtRevision
      .mockResolvedValueOnce(pendingRead('rev-ready', requested))
      .mockResolvedValueOnce(resolvedRead('rev-committed', requested, 4, 4));
    let reentrantTask: ReturnType<typeof navigateBrowserReaderToLocator> | undefined;
    state.layoutCommittedListeners.add(() => {
      reentrantTask = navigateBrowserReaderToLocator(state, requested);
    });

    const firstTask = navigateBrowserReaderToLocator(state, requested);
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    pending[0]?.resolve(revisionWithSelectedSpread('rev-committed', 4));
    await settleUntil(() => reentrantTask !== undefined);

    await expect(firstTask).resolves.toBeUndefined();
    await expect(reentrantTask).resolves.toMatchObject({ status: 'resolved', spreadIndex: 4 });
    expect(fixture.resolveSourceLocatorAtRevision).toHaveBeenCalledTimes(2);
    expect(fixture.createViewRevision).toHaveBeenCalledOnce();
  });

  it('does not let a committed navigation exact read block its replacement', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const first = locator(15);
    const latest = locator(75);
    const firstExact = createDeferred<LocatorRead>();
    fixture.resolveSourceLocatorAtRevision
      .mockResolvedValueOnce(pendingRead('rev-ready', first))
      .mockReturnValueOnce(firstExact.promise)
      .mockResolvedValueOnce(pendingRead('rev-first', latest))
      .mockResolvedValueOnce(resolvedRead('rev-latest', latest, 4, 4));

    const firstTask = navigateBrowserReaderToLocator(state, first);
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    pending[0]?.resolve(revisionWithSelectedSpread('rev-first', 1));
    await settleUntil(() => fixture.resolveSourceLocatorAtRevision.mock.calls.length === 2);

    const latestTask = navigateBrowserReaderToLocator(state, latest);
    await expect(firstTask).resolves.toBeUndefined();
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 2);
    expect(firstExact.promise).toBeInstanceOf(Promise);

    pending[1]?.resolve(revisionWithSelectedSpread('rev-latest', 4));
    await expect(latestTask).resolves.toMatchObject({ status: 'resolved', spreadIndex: 4 });
    firstExact.resolve(resolvedRead('rev-first', first, 1, 1));
    await flushPromises();
    expect(state.reflow.lastError).toBeUndefined();
  });

  it('does not repaginate a chained locator already resolved in the new revision', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const first = locator(20);
    const next = locator(30);
    fixture.resolveSourceLocatorAtRevision
      .mockResolvedValueOnce(pendingRead('rev-ready', first))
      .mockResolvedValueOnce(resolvedRead('rev-first', first, 2, 2))
      .mockResolvedValueOnce(resolvedRead('rev-first', next, 3, 3));

    const firstTask = navigateBrowserReaderToLocator(state, first);
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    pending[0]?.resolve(revisionWithSelectedSpread('rev-first', 2));
    await expect(firstTask).resolves.toMatchObject({ status: 'resolved', spreadIndex: 2 });

    await expect(navigateBrowserReaderToLocator(state, next)).resolves.toMatchObject({
      status: 'resolved',
      spreadIndex: 3,
    });
    expect(fixture.createViewRevision).toHaveBeenCalledOnce();
  });

  it.each(['abort', 'manual'] as const)(
    'ignores a late final exact failure after %s cancellation',
    async (cancellation) => {
      const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
      const fixture = createWorker((deferred) => pending.push(deferred));
      const state = readyState(fixture.worker);
      const requested = locator(55);
      const exact = createDeferred<LocatorRead>();
      const controller = new AbortController();
      fixture.resolveSourceLocatorAtRevision
        .mockResolvedValueOnce(pendingRead('rev-ready', requested))
        .mockReturnValueOnce(exact.promise);

      const task = navigateBrowserReaderToLocator(state, requested, controller.signal);
      await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
      pending[0]?.resolve(revisionWithSelectedSpread('rev-cancel', 3));
      await settleUntil(() => fixture.resolveSourceLocatorAtRevision.mock.calls.length === 2);

      if (cancellation === 'abort') controller.abort();
      else notifySpreadRendered(state, 2);
      await expect(task).resolves.toBeUndefined();
      scheduleBrowserReaderReflow(
        state,
        { ...BASE_READER_OPTIONS, width: 1000 },
        'single',
        'greedy',
      );
      await settleUntil(() => fixture.createViewRevision.mock.calls.length === 2);

      exact.reject(new Error('late cancelled exact failure'));
      await flushPromises();
      expect(state.reflow.lastError).toBeUndefined();
      expect(state.logger.error).not.toHaveBeenCalled();

      const selectedSpread = cancellation === 'abort' ? 3 : 2;
      pending[1]?.resolve(revisionWithSelectedSpread('rev-after-cancel', selectedSpread));
      await settleUntil(() => state.revisionBundle.revision.revisionId === 'rev-after-cancel');
    },
  );

  it('rejects and releases a locator full revision without a selected frame', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const requested = locator(65);
    fixture.resolveSourceLocatorAtRevision.mockResolvedValueOnce(
      pendingRead('rev-ready', requested),
    );

    const task = navigateBrowserReaderToLocator(state, requested);
    const rejected = expect(task).rejects.toThrow('missing a matching selected frame');
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    pending[0]?.resolve(revisionWithoutSelectedFrame('rev-missing-frame'));

    await rejected;
    expect(fixture.releaseRevision).toHaveBeenCalledWith('rev-missing-frame');
    expect(state.revisionBundle.revision.revisionId).toBe('rev-ready');
  });

  it('rejects a final exact projection outside the committed selected spread', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const requested = locator(70);
    fixture.resolveSourceLocatorAtRevision
      .mockResolvedValueOnce(pendingRead('rev-ready', requested))
      .mockResolvedValueOnce(resolvedRead('rev-spread-mismatch', requested, 2, 2));

    const task = navigateBrowserReaderToLocator(state, requested);
    const rejected = expect(task).rejects.toThrow('does not match its selected spread');
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    pending[0]?.resolve(revisionWithSelectedSpread('rev-spread-mismatch', 3));

    await rejected;
    expect(state.activeSpreadIndex).toBe(3);
    expect(state.reflow.lastError?.message).toContain('does not match its selected spread');
  });

  it('settles an aborted probe without dispatching late work', async () => {
    const fixture = createWorker(() => undefined);
    const state = readyState(fixture.worker);
    const probe = createDeferred<LocatorRead>();
    fixture.resolveSourceLocatorAtRevision.mockReturnValue(probe.promise);
    const controller = new AbortController();

    const task = navigateBrowserReaderToLocator(state, locator(30), controller.signal);
    controller.abort();

    await expect(task).resolves.toBeUndefined();
    probe.reject(new Error('late probe failure'));
    await flushPromises();
    expect(fixture.createViewRevision).not.toHaveBeenCalled();
    expect(state.reflow.lastError).toBeUndefined();
    expect(state.logger.error).not.toHaveBeenCalled();
  });

  it('cancels locator ownership on manual spread navigation and finishes the full layout', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const requested = locator(40);
    const current = locator(5);
    fixture.resolveSourceLocatorAtRevision.mockResolvedValueOnce(
      pendingRead('rev-ready', requested),
    );
    fixture.getPageReadingAnchorAtRevision.mockResolvedValue(
      resolvedAnchor('rev-ready', current, 2, 2),
    );

    const task = navigateBrowserReaderToLocator(state, requested);
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    notifySpreadRendered(state, 2);

    await expect(task).resolves.toBeUndefined();
    pending[0]?.resolve(revisionResult('rev-stale-navigation', 5, 5));
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 2);

    expect(fixture.releaseRevision).toHaveBeenCalledWith('rev-stale-navigation');
    expect(fixture.createViewRevision.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        mode: 'full',
        activeSpreadIndex: 2,
        preserveLocator: current,
      }),
    );

    pending[1]?.resolve(revisionWithSelectedSpread('rev-manual-layout', 2));
    await settleUntil(() => state.revisionBundle.revision.revisionId === 'rev-manual-layout');
    expect(fixture.resolveSourceLocatorAtRevision).toHaveBeenCalledOnce();
    expect(state.activeSpreadIndex).toBe(2);
    expect(state.reflow.lastError).toBeUndefined();
  });

  it('settles a pending navigation when the reader is disposed', async () => {
    const fixture = createWorker(() => undefined);
    const state = readyState(fixture.worker);
    const probe = createDeferred<LocatorRead>();
    fixture.resolveSourceLocatorAtRevision.mockReturnValue(probe.promise);
    const reader = buildBrowserReaderMethods(state, BASE_READER_OPTIONS);

    const task = reader.navigateToLocator?.(locator(50));
    reader.dispose();

    await expect(task).resolves.toBeUndefined();
    probe.reject(new Error('late disposed probe'));
    await flushPromises();
    expect(fixture.dispose).toHaveBeenCalledOnce();
    expect(fixture.createViewRevision).not.toHaveBeenCalled();
    expect(state.reflow.lastError).toBeUndefined();
  });

  it('rejects when a full revision still cannot project the locator', async () => {
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const requested = locator(60);
    fixture.resolveSourceLocatorAtRevision
      .mockResolvedValueOnce(pendingRead('rev-ready', requested))
      .mockResolvedValueOnce(pendingRead('rev-full-pending', requested));

    const task = navigateBrowserReaderToLocator(state, requested);
    const rejected = expect(task).rejects.toThrow(
      'Reader locator navigation full revision did not resolve its locator',
    );
    await settleUntil(() => fixture.createViewRevision.mock.calls.length === 1);
    pending[0]?.resolve(revisionResult('rev-full-pending', 5, 5));

    await rejected;
    expect(state.revisionBundle.revision.revisionId).toBe('rev-full-pending');
    expect(state.reflow.lastError?.message).toContain(
      'Reader locator navigation full revision did not resolve its locator',
    );
    expect(state.logger.error).toHaveBeenCalledOnce();
  });
});

function readyState(worker: BrowserReaderWorkerClient): BrowserReaderState {
  const state = createState(worker);
  setRevisionState(state, revisionSummary('rev-ready', 5, 5, 'ready'));
  return state;
}

function locator(textOffset: number): ReaderLocator & {
  readonly sourcePoint: { readonly nodePath: number[]; readonly textOffset: number };
} {
  return {
    href: 'Text/chapter.xhtml',
    sourcePoint: { nodePath: [0, 1], textOffset },
    progression: textOffset / 100,
  };
}

function handle(revisionId: string) {
  return { revisionId, revisionVersion: 0 };
}

function resolvedRead(
  revisionId: string,
  sourceLocator: ReaderLocator,
  pageIndex: number,
  spreadIndex: number,
): LocatorRead {
  return {
    revision: handle(revisionId),
    value: {
      status: 'resolved',
      revisionId,
      locator: sourceLocator,
      spineIdref: 'chapter',
      pageIndex,
      spreadIndex,
      matchedBy: 'sourcePoint',
    },
  };
}

function pendingRead(revisionId: string, sourceLocator: ReaderLocator): LocatorRead {
  return {
    revision: handle(revisionId),
    value: {
      status: 'pending',
      revisionId,
      locator: sourceLocator,
      spineIdref: 'chapter',
      reason: 'notPaginated',
      matchedBy: 'sourcePoint',
    },
  };
}

function resolvedAnchor(
  revisionId: string,
  sourceLocator: ReaderLocator,
  pageIndex: number,
  spreadIndex: number,
) {
  return {
    revision: handle(revisionId),
    value: {
      status: 'resolved' as const,
      revisionId,
      pageIndex,
      spreadIndex,
      locator: sourceLocator,
    },
  };
}

function revisionWithSelectedSpread(
  revisionId: string,
  spreadIndex: number,
): BrowserReaderRevisionResult {
  const base = revisionResult(revisionId, 5, 5);
  const frame = frameBuffer(revisionId, spreadIndex);
  return {
    ...base,
    frameSelection: { spreadIndex, displaySpreadIndex: spreadIndex },
    selectedFrame: { spreadIndex, displaySpreadIndex: spreadIndex, frame },
    frameWindow: {
      plan: {
        revisionId,
        centerSpreadIndex: spreadIndex,
        displaySpreadIndex: spreadIndex,
        spreadIndexes: [spreadIndex],
      },
      frames: [frame],
      spreads: [{ spreadIndex, resources: [] }],
    },
  };
}

function revisionWithoutSelectedFrame(revisionId: string): BrowserReaderRevisionResult {
  const result = revisionResult(revisionId, 5, 5);
  return {
    bundle: result.bundle,
    preview: result.preview,
    ...(result.frameWindow ? { frameWindow: result.frameWindow } : {}),
  };
}

function attachDeferredPreview(
  state: BrowserReaderState,
  previewWorker: BrowserReaderWorkerClient,
): void {
  const config = { ...state.config, viewportWidth: 900 };
  const request = {
    config,
    spreadMode: state.spreadMode,
    lineBreaking: state.lineBreaking,
    token: state.reflow.token,
  };
  state.reflow.deferred = {
    request,
    followUp: {
      delayMs: 60_000,
      request: {
        layoutConfig: config,
        lineBreaking: state.lineBreaking,
        activeSpreadIndex: state.activeSpreadIndex,
        previousRevisionId: 'rev-ready',
        mode: 'full',
      },
    },
  };
  state.reflow.deferredTimer = setTimeout(() => undefined, 60_000);
  state.visualPreview = {
    revision: {
      workerSessionId: previewWorker.sessionId,
      revisionId: 'rev-preview',
      revisionVersion: 0,
    },
    baseCommitGeneration: state.commitGeneration,
    interactionPolicy: 'disabled',
    spreadIndex: 0,
    frame: {
      revisionId: 'rev-preview',
      spreadIndex: 0,
      width: 800,
      height: 600,
      commands: [],
      commandHash: 'preview',
      resourceRefs: { images: [] },
      fontFamilies: [],
      imageDominated: false,
    },
    config: { ...state.config, viewportWidth: 850 },
    spreadMode: state.spreadMode,
    lineBreaking: state.lineBreaking,
    worker: previewWorker,
  };
}

async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 12 && !predicate(); attempt += 1) await flushPromises();
  expect(predicate()).toBe(true);
}
