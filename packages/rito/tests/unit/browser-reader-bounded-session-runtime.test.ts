import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '../../src/reader';
import {
  completeBrowserReaderBoundedSession,
  ensureBrowserReaderBoundedLocator,
  ensureBrowserReaderBoundedSpread,
  startBrowserReaderBoundedCandidate,
} from '../../src/bindings/browser/bounded-session-runtime';
import { retireBrowserReaderBoundedOwner } from '../../src/bindings/browser/bounded-session-owner';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  disposeBrowserReaderSessionHosts,
  recordBrowserReaderAcceptedRevision,
  type BrowserReaderBoundedSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import { isCurrentRevisionHandle } from '../../src/bindings/browser/reader/pipeline/revision-handle';
import { toCoreLayoutConfig } from '../../src/bindings/browser/reader-layout';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { createFontGeometryReplacementWorker } from './browser-reader-bounded-session-runtime-fixtures';
import {
  createDeferred,
  createState,
  createWorker,
  frameBuffer,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

const CHAPTER_LOCAL_PREVIEW_GATE = Symbol.for('@ritojs/core/browser/chapter-local-preview');

describe('Browser bounded session runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, CHAPTER_LOCAL_PREVIEW_GATE);
  });

  it('starts a finite candidate and retires the previous owner after atomic commit', async () => {
    const previous = createWorker(() => undefined, 'previous');
    const candidate = createWorker(() => undefined, 'candidate');
    const state = createState(previous.worker);
    const initial = boundedSnapshot('old', 0, 1, 'ready');
    setRevisionState(state, initial.revision, initial.navigation);
    const previousControllerDispose = vi.fn(() => Promise.resolve());
    const previousOwner = owner(previous.worker, { dispose: previousControllerDispose });
    recordBrowserReaderAcceptedRevision(previousOwner, initial.revision);
    state.boundedSessions.current = previousOwner;
    const next = boundedSnapshot('next', 1, 2, 'ready');
    const start = vi.fn(() => Promise.resolve(next));
    const candidateOwner = owner(candidate.worker, { start });
    recordBrowserReaderAcceptedRevision(candidateOwner, next.revision);
    mockAggregates(candidate.worker, next);

    const committed = await startBrowserReaderBoundedCandidate(state, candidateOwner, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      targetSpreadIndex: 1,
    });

    expect(committed).toBe(next);
    expect(start).toHaveBeenCalledWith({
      layoutConfig: toCoreLayoutConfig(state.config, state.fontMetrics),
      lineBreaking: 'greedy',
      budget: { maxTopLevelNodes: 32 },
      growthBudget: { maxTopLevelNodes: 32 },
      targetSpreadIndex: 1,
    });
    expect(state.boundedSessions.current).toBe(candidateOwner);
    expect(previousControllerDispose).toHaveBeenCalledOnce();
    expect(previous.dispose).toHaveBeenCalledOnce();
  });

  it('forces previous worker retirement when its controller never settles', async () => {
    vi.useFakeTimers();
    const previous = createWorker(() => undefined, 'stalled-previous');
    const candidate = createWorker(() => undefined, 'candidate-after-stalled-previous');
    const state = createState(previous.worker);
    const initial = boundedSnapshot('old', 0, 1, 'ready');
    setRevisionState(state, initial.revision, initial.navigation);
    const previousControllerDispose = vi.fn(() => new Promise<void>(() => undefined));
    const previousOwner = owner(previous.worker, { dispose: previousControllerDispose });
    recordBrowserReaderAcceptedRevision(previousOwner, initial.revision);
    state.boundedSessions.current = previousOwner;
    const next = boundedSnapshot('next', 0, 1, 'ready');
    const candidateOwner = owner(candidate.worker, {
      start: vi.fn(() => Promise.resolve(next)),
    });
    recordBrowserReaderAcceptedRevision(candidateOwner, next.revision);
    mockAggregates(candidate.worker, next);

    const task = startBrowserReaderBoundedCandidate(state, candidateOwner, {
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      targetSpreadIndex: 0,
    });
    await waitForCall(previousControllerDispose);

    expect(previous.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(task).resolves.toBe(next);

    expect(state.logger.warn).toHaveBeenCalledWith(
      'bounded reader session retirement failed',
      expect.objectContaining({ message: 'bounded reader dispose timed out after 1000ms' }),
    );
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(previous.whenDisposed).toHaveBeenCalledOnce();
  });

  it('drops a candidate when navigation moves after its anchor was captured', async () => {
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'stale-navigation');
    const snapshot = boundedSnapshot('stale-navigation', 0, 1, 'ready');
    const candidateOwner = owner(candidate.worker, {
      start: vi.fn(() => Promise.resolve(snapshot)),
    });
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    const { readFootnotes } = mockAggregates(candidate.worker, snapshot);
    const task = startBrowserReaderBoundedCandidate(fixture.state, candidateOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
      expectedActiveSpreadIndex: 0,
    });
    fixture.state.activeSpreadIndex = 1;

    await expect(task).resolves.toBeUndefined();
    expect(readFootnotes).not.toHaveBeenCalled();
    expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('current');
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it('publishes the candidate callback before layout listeners', async () => {
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'callback-order');
    const snapshot = boundedSnapshot('callback-order', 0, 1, 'ready');
    const candidateOwner = owner(candidate.worker, {
      start: vi.fn(() => Promise.resolve(snapshot)),
    });
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    mockAggregates(candidate.worker, snapshot);
    const order: string[] = [];
    fixture.state.layoutCommittedListeners.add(() => order.push('listener'));

    await startBrowserReaderBoundedCandidate(fixture.state, candidateOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
      onCommitted: () => order.push('callback'),
    });

    expect(order).toEqual(['callback', 'listener']);
  });

  it('does not let an older candidate overwrite a newer committed layout', async () => {
    const fixture = currentFixture();
    const staleWorker = createWorker(() => undefined, 'stale-candidate');
    const staleDrain = createDeferred<undefined>();
    const staleOwner = owner(staleWorker.worker, { dispose: vi.fn(() => staleDrain.promise) });
    fixture.state.boundedSessions.candidate = staleOwner;
    const firstWorker = createWorker(() => undefined, 'first-candidate');
    const firstStart = vi.fn<BrowserReaderBoundedSessionOwner['controller']['start']>();
    const firstOwner = owner(firstWorker.worker, { start: firstStart });
    const first = startBrowserReaderBoundedCandidate(fixture.state, firstOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
    });
    await Promise.resolve();

    const latestWorker = createWorker(() => undefined, 'latest-candidate');
    const latestSnapshot = boundedSnapshot('latest', 0, 1, 'ready');
    const latestOwner = owner(latestWorker.worker, {
      start: vi.fn(() => Promise.resolve(latestSnapshot)),
    });
    recordBrowserReaderAcceptedRevision(latestOwner, latestSnapshot.revision);
    mockAggregates(latestWorker.worker, latestSnapshot);

    await expect(
      startBrowserReaderBoundedCandidate(fixture.state, latestOwner, {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      }),
    ).resolves.toBe(latestSnapshot);
    staleDrain.resolve(undefined);

    await expect(first).resolves.toBeUndefined();
    expect(firstStart).not.toHaveBeenCalled();
    expect(fixture.state.boundedSessions.current).toBe(latestOwner);
    expect(fixture.state.revisionBundle.revision).toBe(latestSnapshot.revision);
  });

  it('aborts a candidate during commit preparation without publishing it', async () => {
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'aborted-candidate');
    const snapshot = boundedSnapshot('aborted', 0, 1, 'ready');
    const controllerDispose = vi.fn(() => Promise.resolve());
    const candidateOwner = owner(candidate.worker, {
      start: vi.fn(() => Promise.resolve(snapshot)),
      dispose: controllerDispose,
    });
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    const footnotes =
      createDeferred<Awaited<ReturnType<BrowserReaderWorkerClient['getFootnotesAtRevision']>>>();
    const revision = revisionHandle(snapshot);
    const readFootnotes = vi.fn(() => footnotes.promise);
    Object.assign(candidate.worker, {
      getFootnotesAtRevision: readFootnotes,
      getChapterTextIndicesAtRevision: vi.fn(() =>
        Promise.resolve({
          revision,
          value: { revisionId: revision.revisionId, entries: {} },
        }),
      ),
    });
    const abort = new AbortController();

    const task = startBrowserReaderBoundedCandidate(
      fixture.state,
      candidateOwner,
      {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      },
      abort.signal,
    );
    await waitForCall(readFootnotes);
    abort.abort();
    footnotes.resolve({
      revision,
      value: { revisionId: revision.revisionId, complete: true, pendingKeys: [], entries: {} },
    });

    await expect(task).resolves.toBeUndefined();
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('current');
    expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
    expect(controllerDispose).toHaveBeenCalled();
    expect(candidate.dispose).toHaveBeenCalled();
  });

  it('drains detached candidate retirement before disposing the worker factory', async () => {
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'detached-candidate');
    const startResult = createDeferred<BrowserReaderBoundedSnapshot>();
    const retirement = createDeferred<undefined>();
    const start = vi.fn(() => startResult.promise);
    const controllerDispose = vi.fn(() => retirement.promise);
    const candidateOwner = owner(candidate.worker, { start, dispose: controllerDispose });
    const abort = new AbortController();
    const factoryDispose = vi.fn(async () => {
      fixture.worker.dispose();
      await fixture.worker.whenDisposed();
    });
    Object.defineProperty(fixture.state, 'workerFactory', {
      value: Object.assign(() => fixture.worker, { dispose: factoryDispose }),
    });
    const candidateTask = startBrowserReaderBoundedCandidate(
      fixture.state,
      candidateOwner,
      {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      },
      abort.signal,
    );
    await waitForCall(start);

    abort.abort();
    disposeBrowserReaderSessionHosts(fixture.state);
    await waitForCall(controllerDispose);

    expect(fixture.state.boundedSessions).toEqual({ current: undefined, candidate: undefined });
    expect(candidate.dispose).not.toHaveBeenCalled();
    expect(factoryDispose).not.toHaveBeenCalled();

    retirement.resolve(undefined);
    await fixture.state.disposeTask;

    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(candidate.whenDisposed).toHaveBeenCalledOnce();
    expect(factoryDispose).toHaveBeenCalledOnce();
    startResult.reject(new Error('candidate stopped'));
    await expect(candidateTask).resolves.toBeUndefined();
    expect(controllerDispose).toHaveBeenCalledOnce();
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it('forces full idempotent retirement when an aborted candidate controller stalls', async () => {
    vi.useFakeTimers();
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'stalled-aborted-candidate');
    const startResult = createDeferred<BrowserReaderBoundedSnapshot>();
    const start = vi.fn(() => startResult.promise);
    const controllerDispose = vi.fn(() => new Promise<void>(() => undefined));
    const candidateOwner = owner(candidate.worker, { start, dispose: controllerDispose });
    const abort = new AbortController();
    const loggingFailure = new Error('retirement logger failed');
    vi.mocked(fixture.state.logger.warn).mockImplementation(() => {
      throw loggingFailure;
    });
    const candidateTask = startBrowserReaderBoundedCandidate(
      fixture.state,
      candidateOwner,
      {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      },
      abort.signal,
    );
    await waitForCall(start);

    abort.abort();
    await waitForCall(controllerDispose);
    expect(candidate.dispose).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    await waitForCall(candidate.dispose);

    expect(fixture.state.logger.warn).toHaveBeenCalledWith(
      'bounded reader session retirement failed',
      expect.objectContaining({ message: 'bounded reader dispose timed out after 1000ms' }),
    );
    expect(candidate.whenDisposed).toHaveBeenCalledOnce();
    startResult.reject(new Error('candidate stopped'));
    await expect(candidateTask).resolves.toBeUndefined();
    expect(controllerDispose).toHaveBeenCalledOnce();
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it('drops completed retirements from the reader pending drain without losing idempotence', async () => {
    const foreground = createWorker(() => undefined, 'completed-retirement-foreground');
    const state = createState(foreground.worker);
    for (let index = 0; index < 3; index += 1) {
      const retired = createWorker(() => undefined, `completed-retirement-${String(index)}`);
      const controllerDispose = vi.fn(() => Promise.resolve());
      const retiredOwner = owner(retired.worker, { dispose: controllerDispose });

      await Promise.all([
        retireBrowserReaderBoundedOwner(state, retiredOwner),
        retireBrowserReaderBoundedOwner(state, retiredOwner),
      ]);

      expect(controllerDispose).toHaveBeenCalledOnce();
      expect(retired.dispose).toHaveBeenCalledOnce();
      expect(retired.whenDisposed).toHaveBeenCalledOnce();
    }
    const factoryDispose = vi.fn(() => Promise.resolve());
    Object.defineProperty(state, 'workerFactory', {
      value: Object.assign(() => foreground.worker, { dispose: factoryDispose }),
    });
    const allSettled = vi.spyOn(Promise, 'allSettled');

    disposeBrowserReaderSessionHosts(state);
    await state.disposeTask;

    expect(factoryDispose).toHaveBeenCalledOnce();
    expect(allSettled).toHaveBeenCalledOnce();
    expect(Array.from(allSettled.mock.calls[0]?.[0] ?? [])).toEqual([]);
    allSettled.mockRestore();
  });

  it('uses a one-node startup quantum for spread zero and a larger growth quantum', async () => {
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'first-spread-budget');
    const snapshot = boundedSnapshot('first-spread-budget', 0, 1, 'ready');
    const start = vi.fn(() => Promise.resolve(snapshot));
    const candidateOwner = owner(candidate.worker, { start });
    recordBrowserReaderAcceptedRevision(candidateOwner, snapshot.revision);
    mockAggregates(candidate.worker, snapshot);

    await startBrowserReaderBoundedCandidate(fixture.state, candidateOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
    });

    expect(start).toHaveBeenCalledWith({
      layoutConfig: toCoreLayoutConfig(fixture.state.config, fixture.state.fontMetrics),
      lineBreaking: 'greedy',
      budget: { maxTopLevelNodes: 1 },
      growthBudget: { maxTopLevelNodes: 32 },
      targetSpreadIndex: 0,
    });
  });

  it('rejects a shared-worker candidate without disposing the current worker', async () => {
    const fixture = currentFixture();
    const controllerDispose = vi.fn(() => Promise.resolve());
    const duplicate = owner(fixture.worker, { dispose: controllerDispose });

    await expect(
      startBrowserReaderBoundedCandidate(fixture.state, duplicate, {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      }),
    ).rejects.toThrow('independent worker session');
    expect(controllerDispose).toHaveBeenCalledOnce();
    expect(fixture.dispose).not.toHaveBeenCalled();
    expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
  });

  it('rejects a candidate aliased to the previous candidate worker', async () => {
    const fixture = currentFixture();
    const shared = createWorker(() => undefined, 'shared-candidate');
    const previous = owner(shared.worker);
    fixture.state.boundedSessions.candidate = previous;
    const duplicateDispose = vi.fn(() => Promise.resolve());
    const duplicate = owner(shared.worker, { dispose: duplicateDispose });

    await expect(
      startBrowserReaderBoundedCandidate(fixture.state, duplicate, {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      }),
    ).rejects.toThrow('independent worker sessions');
    expect(duplicateDispose).toHaveBeenCalledOnce();
    expect(shared.dispose).not.toHaveBeenCalled();
    expect(fixture.state.boundedSessions.candidate).toBe(previous);
  });

  it('treats Reader disposal during candidate start as cancellation', async () => {
    const fixture = currentFixture();
    const candidate = createWorker(() => undefined, 'disposed-candidate');
    const started = createDeferred<BrowserReaderBoundedSnapshot>();
    const start = vi.fn(() => started.promise);
    const candidateOwner = owner(candidate.worker, { start });
    const task = startBrowserReaderBoundedCandidate(fixture.state, candidateOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
    });
    await waitForCall(start);

    fixture.state.disposed = true;
    started.reject(new Error('bounded reader session stopped'));

    await expect(task).resolves.toBeUndefined();
    expect(candidate.dispose).toHaveBeenCalled();
  });

  it('commits an accepted spread after abort but resolves the caller as cancelled', async () => {
    const fixture = currentFixture();
    const next = boundedSnapshot('current', 1, 2, 'ready');
    const deferred = createDeferred<BrowserReaderBoundedSnapshot>();
    const ensureSpread = vi.fn(() => deferred.promise);
    fixture.owner.controller.ensureSpread = ensureSpread;
    const abort = new AbortController();
    const committed = vi.fn();
    fixture.state.layoutCommittedListeners.add(committed);

    const task = ensureBrowserReaderBoundedSpread(fixture.state, 1, abort.signal);
    await waitForCall(ensureSpread);
    abort.abort();
    recordBrowserReaderAcceptedRevision(fixture.owner, next.revision);
    mockAggregates(fixture.worker, next);
    deferred.resolve(next);

    await expect(task).resolves.toBeUndefined();
    expect(fixture.state.revisionBundle.revision).toBe(next.revision);
    expect(fixture.owner.readsSuspended).toBe(false);
    expect(committed).not.toHaveBeenCalled();
  });

  it('keeps an ordinary same-owner spread append silent', async () => {
    const fixture = currentFixture();
    const next = boundedSnapshot('current', 1, 2, 'ready');
    fixture.owner.controller.ensureSpread = vi.fn(() => {
      recordBrowserReaderAcceptedRevision(fixture.owner, next.revision);
      return Promise.resolve(next);
    });
    mockAggregates(fixture.worker, next);
    const committed = vi.fn();
    fixture.state.layoutCommittedListeners.add(committed);
    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 1)).resolves.toBe(true);
    expect(committed).not.toHaveBeenCalled();
  });

  it('publishes a layout commit when spread growth requires a font-geometry replacement', async () => {
    const fixture = currentFixture();
    const uncalibrated = boundedSnapshot('current', 1, 2, 'ready');
    fixture.owner.controller.ensureSpread = vi.fn(() => {
      recordBrowserReaderAcceptedRevision(fixture.owner, uncalibrated.revision);
      return Promise.resolve(uncalibrated);
    });
    mockAggregates(fixture.worker, uncalibrated);

    const calibrated = boundedSnapshot('calibrated', 1, 2, 'ready', { revisionVersion: 0 });
    const candidate = createFontGeometryReplacementWorker(fixture.state, calibrated);
    const committed = vi.fn();
    fixture.state.layoutCommittedListeners.add(committed);
    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 1)).resolves.toBe(true);

    expect(fixture.state.boundedSessions.current?.worker).toBe(candidate);
    expect(fixture.state.revisionBundle.revision.revisionId).toBe('calibrated');
    expect(committed).toHaveBeenCalledOnce();
    // A growth commit extends the table without moving the visible
    // spread: the reader stays where it is and the navigation layer
    // performs the turn when it resumes off this commit.
    expect(committed).toHaveBeenCalledWith(0);
  });

  it('commits a complete final miss before returning false', async () => {
    const fixture = currentFixture();
    const final = boundedSnapshot('current', 1, 1, 'complete', {
      target: { kind: 'spread', spreadIndex: 3 },
      withFrame: false,
    });
    fixture.owner.controller.ensureSpread = vi.fn(() => Promise.resolve(final));
    recordBrowserReaderAcceptedRevision(fixture.owner, final.revision);
    mockAggregates(fixture.worker, final);

    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 3)).resolves.toBe(false);
    expect(fixture.state.revisionBundle.revision.status).toBe('complete');
    expect(fixture.state.activeSpreadIndex).toBe(0);
  });

  it('copies a locator and returns its committed public resolution', async () => {
    const fixture = currentFixture();
    const locator: ReaderLocator = {
      href: 'chapter.xhtml',
      sourcePoint: { nodePath: [1, 2], textOffset: 3 },
    };
    const resolved = boundedSnapshot('current', 1, 2, 'ready', {
      target: {
        kind: 'locator',
        locator,
        resolution: {
          status: 'resolved',
          revisionId: 'current',
          locator,
          spineIdref: 'chapter',
          pageIndex: 1,
          spreadIndex: 1,
          matchedBy: 'sourcePoint',
        },
      },
    });
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      () => Promise.resolve(resolved),
    );
    fixture.owner.controller.ensureLocator = ensureLocator;
    recordBrowserReaderAcceptedRevision(fixture.owner, resolved.revision);
    mockAggregates(fixture.worker, resolved);

    const task = ensureBrowserReaderBoundedLocator(fixture.state, locator);
    await expect(task).resolves.toEqual({
      status: 'resolved',
      locator,
      spineIdref: 'chapter',
      pageIndex: 1,
      spreadIndex: 1,
      matchedBy: 'sourcePoint',
    });
    const request = ensureLocator.mock.calls[0]?.[0];
    expect(request).not.toBe(locator);
    expect(request?.sourcePoint?.nodePath).not.toBe(locator.sourcePoint?.nodePath);
  });

  it('publishes a calibrated exact-only locator before resolving its atomic handoff', async () => {
    Object.defineProperty(globalThis, CHAPTER_LOCAL_PREVIEW_GATE, {
      configurable: true,
      value: false,
    });
    const fixture = currentFixture();
    const locator: ReaderLocator = { href: 'chapter.xhtml' };
    const demanded = withVerticalMetricDemand(
      boundedSnapshot('current', 1, 2, 'ready', {
        target: {
          kind: 'locator',
          locator,
          resolution: {
            status: 'resolved',
            revisionId: 'current',
            locator,
            spineIdref: 'chapter',
            pageIndex: 1,
            spreadIndex: 1,
            matchedBy: 'href',
          },
        },
      }),
    );
    const calibrated = withoutVerticalMetricDemand(demanded);
    fixture.owner.controller.ensureLocator = vi.fn(() => {
      recordBrowserReaderAcceptedRevision(fixture.owner, demanded.revision);
      mockAggregates(fixture.worker, demanded);
      return Promise.resolve(demanded);
    });
    const calibrateFontVerticalMetrics = vi.fn(() => {
      recordBrowserReaderAcceptedRevision(fixture.owner, calibrated.revision);
      mockAggregates(fixture.worker, calibrated);
      return Promise.resolve(calibrated);
    });
    fixture.owner.controller.calibrateFontVerticalMetrics = calibrateFontVerticalMetrics;
    Object.assign(fixture.state.ctx, {
      save: vi.fn(),
      restore: vi.fn(),
      measureText: vi.fn(() => ({
        width: 16,
        fontBoundingBoxAscent: 3,
        fontBoundingBoxDescent: 14,
      })),
      font: '',
      textBaseline: 'alphabetic',
    });
    const order: string[] = [];
    fixture.state.layoutCommittedListeners.add((spreadIndex) => {
      order.push(`layout:${String(spreadIndex)}`);
    });

    const resolution = ensureBrowserReaderBoundedLocator(fixture.state, locator).then((value) => {
      order.push('resolved');
      return value;
    });
    await expect(resolution).resolves.toMatchObject({ status: 'resolved', spreadIndex: 1 });

    expect(calibrateFontVerticalMetrics).toHaveBeenCalledOnce();
    expect(order).toEqual(['layout:1', 'resolved']);
    expect(fixture.state.activeSpreadIndex).toBe(1);
    expect(fixture.state.revisionBundle.revision).toBe(calibrated.revision);
  });

  it('completes once and publishes a full layout commit', async () => {
    const fixture = currentFixture();
    const final = boundedSnapshot('current', 0, 1, 'complete', {
      target: { kind: 'complete' },
    });
    const complete = vi.fn(() => Promise.resolve(final));
    fixture.owner.controller.complete = complete;
    recordBrowserReaderAcceptedRevision(fixture.owner, final.revision);
    mockAggregates(fixture.worker, final);
    const committed = vi.fn();
    fixture.state.layoutCommittedListeners.add(committed);

    await expect(completeBrowserReaderBoundedSession(fixture.state)).resolves.toBe(true);
    await expect(completeBrowserReaderBoundedSession(fixture.state)).resolves.toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(committed).toHaveBeenCalledOnce();
  });

  it('restores the exact read gate when growth fails before accepting an advance', async () => {
    const fixture = currentFixture();
    fixture.owner.controller.ensureSpread = vi.fn(() => Promise.reject(new Error('failed')));

    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 1)).rejects.toThrow('failed');
    expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
    expect(fixture.state.revisionHandle).toBeDefined();
    expect(
      fixture.state.revisionHandle &&
        isCurrentRevisionHandle(fixture.state, fixture.state.revisionHandle),
    ).toBe(true);
    expect(fixture.controllerDispose).not.toHaveBeenCalled();
  });

  it('detaches and drains a current owner that fails after accepting an advance', async () => {
    const fixture = currentFixture();
    fixture.owner.controller.ensureSpread = vi.fn(() => {
      recordBrowserReaderAcceptedRevision(fixture.owner, {
        ...fixture.state.revisionBundle.revision,
        revisionVersion: 1,
      });
      return Promise.reject(new Error('terminal'));
    });

    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 1)).rejects.toThrow('terminal');
    expect(fixture.state.boundedSessions.current).toBeUndefined();
    expect(fixture.state.revisionHandle).toBeUndefined();
    expect(fixture.controllerDispose).toHaveBeenCalledOnce();
    expect(fixture.dispose).toHaveBeenCalledOnce();
  });

  it('does not restore a revision released by a terminal controller failure', async () => {
    const fixture = currentFixture();
    fixture.owner.controller.ensureSpread = vi.fn(() => {
      fixture.owner.controller.currentSnapshot = vi.fn(() => undefined);
      return Promise.reject(new Error('terminal cleanup'));
    });

    await expect(ensureBrowserReaderBoundedSpread(fixture.state, 1)).rejects.toThrow(
      'terminal cleanup',
    );
    expect(fixture.state.boundedSessions.current).toBeUndefined();
    expect(fixture.state.revisionHandle).toBeUndefined();
    expect(fixture.controllerDispose).toHaveBeenCalledOnce();
  });

  it('treats a current mutation stopped by candidate replacement as superseded', async () => {
    const fixture = currentFixture();
    const growth = createDeferred<BrowserReaderBoundedSnapshot>();
    const ensureSpread = vi.fn(() => growth.promise);
    fixture.owner.controller.ensureSpread = ensureSpread;
    const pending = ensureBrowserReaderBoundedSpread(fixture.state, 1);
    await waitForCall(ensureSpread);

    const candidate = createWorker(() => undefined, 'replacement');
    const replacement = boundedSnapshot('replacement', 0, 1, 'ready');
    const replacementOwner = owner(candidate.worker, {
      start: vi.fn(() => Promise.resolve(replacement)),
    });
    recordBrowserReaderAcceptedRevision(replacementOwner, replacement.revision);
    mockAggregates(candidate.worker, replacement);
    await startBrowserReaderBoundedCandidate(fixture.state, replacementOwner, {
      config: fixture.state.config,
      spreadMode: fixture.state.spreadMode,
      lineBreaking: fixture.state.lineBreaking,
      targetSpreadIndex: 0,
    });
    growth.reject(new Error('bounded reader session stopped'));

    await expect(pending).resolves.toBeUndefined();
    expect(fixture.state.boundedSessions.current).toBe(replacementOwner);
  });
});

function currentFixture(): {
  readonly state: BrowserReaderState;
  readonly worker: BrowserReaderWorkerClient;
  readonly owner: BrowserReaderBoundedSessionOwner;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly controllerDispose: ReturnType<typeof vi.fn>;
} {
  const fixture = createWorker(() => undefined, 'current');
  const state = createState(fixture.worker);
  const initial = boundedSnapshot('current', 0, 1, 'ready', { revisionVersion: 0 });
  setRevisionState(state, initial.revision, initial.navigation);
  const controllerDispose = vi.fn(() => Promise.resolve());
  const currentOwner = owner(fixture.worker, {
    dispose: controllerDispose,
    currentSnapshot: vi.fn(() => initial),
  });
  recordBrowserReaderAcceptedRevision(currentOwner, initial.revision);
  state.boundedSessions.current = currentOwner;
  return {
    state,
    worker: fixture.worker,
    owner: currentOwner,
    dispose: fixture.dispose,
    controllerDispose,
  };
}

function owner(
  worker: BrowserReaderWorkerClient,
  overrides: Partial<BrowserReaderBoundedSessionOwner['controller']> = {},
): BrowserReaderBoundedSessionOwner {
  return {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      calibrateFontVerticalMetrics: vi.fn(),
      currentSnapshot: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(() => Promise.resolve()),
      ...overrides,
    },
    worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
}

function boundedSnapshot(
  revisionId: string,
  spreadIndex: number,
  spreadCount: number,
  status: 'ready' | 'complete',
  options: {
    readonly revisionVersion?: number;
    readonly target?: BrowserReaderBoundedSnapshot['target'];
    readonly withFrame?: boolean;
  } = {},
): BrowserReaderBoundedSnapshot {
  const result = revisionResult(revisionId, spreadCount, spreadCount, spreadIndex);
  const revisionVersion = options.revisionVersion ?? 1;
  const revision = {
    ...result.bundle.revision,
    revisionVersion,
    status,
    ...(status === 'complete'
      ? { finalExtent: { pageCount: spreadCount, spreadCount } }
      : { finalExtent: undefined }),
  };
  const navigation = result.bundle.navigation;
  const withFrame = options.withFrame ?? true;
  return {
    generation: revisionVersion + 1,
    revision,
    presentation: {
      revision,
      navigation,
      tocTargets: result.bundle.tocTargets,
      fontFamilies: result.bundle.fontFamilies,
    },
    navigation,
    target: options.target ?? { kind: 'spread', spreadIndex },
    presentationSpreadIndex: spreadIndex,
    ...(withFrame && spreadCount > 0
      ? {
          frameWindow: {
            plan: {
              revisionId,
              centerSpreadIndex: spreadIndex,
              displaySpreadIndex: spreadIndex,
              spreadIndexes: [spreadIndex],
            },
            frames: [frameBuffer(revisionId, spreadIndex)],
            spreads: [{ spreadIndex, resources: [], missingResources: [] }],
          },
        }
      : {}),
  };
}

function withVerticalMetricDemand(
  snapshot: BrowserReaderBoundedSnapshot,
): BrowserReaderBoundedSnapshot {
  return {
    ...snapshot,
    presentation: {
      ...snapshot.presentation,
      fontFamilies: ['ReaderBody'],
      fontVerticalMetricDemands: [
        {
          fontFamily: 'ReaderBody',
          fontStyle: 'normal',
          fontWeight: 400,
          fontSizePx: 16,
        },
      ],
    },
  };
}

function withoutVerticalMetricDemand(
  snapshot: BrowserReaderBoundedSnapshot,
): BrowserReaderBoundedSnapshot {
  const revision = {
    ...snapshot.revision,
    revisionVersion: snapshot.revision.revisionVersion + 1,
  };
  return {
    ...snapshot,
    generation: snapshot.generation + 1,
    revision,
    presentation: {
      ...snapshot.presentation,
      revision,
      fontVerticalMetricDemands: [],
    },
  };
}

function mockAggregates(
  worker: BrowserReaderWorkerClient,
  snapshot: BrowserReaderBoundedSnapshot,
): { readonly readFootnotes: ReturnType<typeof vi.fn> } {
  const revision = {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
  const readFootnotes = vi.fn(() =>
    Promise.resolve({
      revision,
      value: { revisionId: revision.revisionId, complete: true, pendingKeys: [], entries: {} },
    }),
  );
  Object.assign(worker, {
    getFootnotesAtRevision: readFootnotes,
    getChapterTextIndicesAtRevision: vi.fn(() =>
      Promise.resolve({ revision, value: { revisionId: revision.revisionId, entries: {} } }),
    ),
  });
  return { readFootnotes };
}

function revisionHandle(snapshot: BrowserReaderBoundedSnapshot) {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}

async function waitForCall(mock: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 32 && mock.mock.calls.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledOnce();
}
