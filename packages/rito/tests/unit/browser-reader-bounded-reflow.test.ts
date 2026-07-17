import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '../../src/reader';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  type BrowserReaderBoundedSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import {
  cancelBrowserReaderReflow,
  scheduleBrowserReaderReflow,
  startBrowserReaderInitialReflow,
} from '../../src/bindings/browser/reader/pipeline/bounded-reflow';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  BASE_READER_OPTIONS,
  createDeferred,
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

type CreateOwner =
  (typeof import('../../src/bindings/browser/bounded-session-runtime'))['createBrowserReaderBoundedSessionOwner'];
type StartCandidate =
  (typeof import('../../src/bindings/browser/bounded-session-runtime'))['startBrowserReaderBoundedCandidate'];
type OpenWorker =
  (typeof import('../../src/bindings/browser/pinned-fonts'))['openBrowserReaderWorker'];

const mocks = vi.hoisted(() => ({
  createOwner: vi.fn<CreateOwner>(),
  openWorker: vi.fn<OpenWorker>(),
  startCandidate: vi.fn<StartCandidate>(),
}));

vi.mock('../../src/bindings/browser/bounded-session-runtime', () => ({
  createBrowserReaderBoundedSessionOwner: mocks.createOwner,
  startBrowserReaderBoundedCandidate: mocks.startCandidate,
}));

vi.mock('../../src/bindings/browser/pinned-fonts', () => ({
  openBrowserReaderWorker: mocks.openWorker,
}));

describe('Browser bounded reflow coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOwner.mockImplementation((worker: BrowserReaderWorkerClient) => owner(worker));
    mocks.openWorker.mockResolvedValue({} as Awaited<ReturnType<OpenWorker>>);
    mocks.startCandidate.mockResolvedValue(snapshot());
  });

  it('does not queue reflow work after disposal', () => {
    const state = createState(createWorker(() => undefined, 'disposed').worker);
    state.disposed = true;

    expect(
      scheduleBrowserReaderReflow(
        state,
        { ...BASE_READER_OPTIONS, width: 900 },
        'single',
        'greedy',
      ),
    ).toBe(false);
    expect(state.reflow.queued).toBeUndefined();
    expect(state.reflow.microtaskScheduled).toBe(false);
  });

  it('starts the initial bounded session at spread zero on the already-open worker', async () => {
    const foreground = createWorker(() => undefined, 'initial');
    const state = createState(foreground.worker);
    const committed = vi.fn();

    await startBrowserReaderInitialReflow(
      state,
      BASE_READER_OPTIONS,
      'single',
      'greedy',
      committed,
    );

    expect(mocks.openWorker).not.toHaveBeenCalled();
    expect(mocks.createOwner).toHaveBeenCalledWith(foreground.worker);
    expect(mocks.startCandidate).toHaveBeenCalledOnce();
    const call = mocks.startCandidate.mock.calls[0];
    if (!call) throw new Error('Initial bounded candidate was not started');
    const [, candidateOwner, request, signal] = call;
    if (!signal) throw new Error('Initial bounded candidate did not receive cancellation');
    expect(candidateOwner.worker).toBe(foreground.worker);
    expect(request).toMatchObject({
      targetSpreadIndex: 0,
      spreadMode: 'single',
      lineBreaking: 'greedy',
      onCommitted: committed,
    });
    expect(request).not.toHaveProperty('preserveLocator');
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(state.reflow.active).toBeUndefined();
  });

  it('carries an initial locator into the first bounded candidate', async () => {
    const foreground = createWorker(() => undefined, 'initial-locator');
    const state = createState(foreground.worker);
    const locator = sourceLocator('late.xhtml', 18);

    await startBrowserReaderInitialReflow(
      state,
      { ...BASE_READER_OPTIONS, initialLocator: locator },
      'single',
      'greedy',
    );

    const request = mocks.startCandidate.mock.calls[0]?.[2];
    expect(request).toMatchObject({
      targetSpreadIndex: 0,
      preserveLocator: locator,
      fallbackOnLocatorFailure: true,
    });
    expect(request?.preserveLocator).not.toBe(locator);
    expect(request?.preserveLocator?.sourcePoint?.nodePath).not.toBe(locator.sourcePoint?.nodePath);
  });

  it('retries an initial candidate only after exact font geometry grows', async () => {
    const initial = createWorker(() => undefined, 'initial-font-fallback');
    const calibrated = createWorker(() => undefined, 'initial-font-calibrated');
    const state = createState(initial.worker);
    Object.assign(state, { workerFactory: () => calibrated.worker });
    mocks.startCandidate
      .mockImplementationOnce((candidateState) => {
        candidateState.fontMetrics.verticalMetrics['body'] = {
          fontFamily: 'body',
          fontStyle: 'normal',
          fontWeight: 400,
          fontSizePx: 16,
          topBaselineAscentPx: 3,
          topBaselineDescentPx: 14,
        };
        return Promise.resolve(undefined);
      })
      .mockResolvedValueOnce(snapshot());

    await startBrowserReaderInitialReflow(state, BASE_READER_OPTIONS, 'single', 'greedy');

    expect(mocks.startCandidate).toHaveBeenCalledTimes(2);
    expect(mocks.openWorker).toHaveBeenCalledOnce();
    expect(mocks.openWorker).toHaveBeenCalledWith(
      calibrated.worker,
      expect.any(ArrayBuffer),
      state.pinnedFonts.policy,
      state.pinnedFonts.summary,
    );
    expect(mocks.createOwner.mock.calls.map(([worker]) => worker.sessionId)).toEqual([
      initial.worker.sessionId,
      calibrated.worker.sessionId,
    ]);
  });

  it('opens an independent candidate and carries the exact reading anchor into it', async () => {
    const current = currentFixture(3, 1);
    const candidate = createWorker(() => undefined, 'candidate');
    Object.assign(current.state, { workerFactory: () => candidate.worker });
    const locator = sourceLocator('chapter.xhtml', 12);
    resolveAnchor(current.worker, 1, locator);

    expect(
      scheduleBrowserReaderReflow(
        current.state,
        { ...BASE_READER_OPTIONS, width: 900 },
        'single',
        'greedy',
      ),
    ).toBe(true);
    await waitUntil(
      () =>
        mocks.startCandidate.mock.calls.length === 1 ||
        current.state.reflow.lastError !== undefined,
    );
    expect(current.state.reflow.lastError).toBeUndefined();

    expect(mocks.openWorker).toHaveBeenCalledWith(
      candidate.worker,
      expect.any(ArrayBuffer),
      current.state.pinnedFonts.policy,
      current.state.pinnedFonts.summary,
    );
    const call = mocks.startCandidate.mock.calls[0];
    if (!call) throw new Error('Bounded reflow candidate was not started');
    const [, candidateOwner, request, signal] = call;
    if (!signal) throw new Error('Bounded reflow candidate did not receive cancellation');
    expect(candidateOwner.worker).toBe(candidate.worker);
    expect(request).toMatchObject({
      targetSpreadIndex: 1,
      expectedActiveSpreadIndex: 1,
      preserveLocator: locator,
    });
    expect(signal.aborted).toBe(false);
    const anchorRead = vi.spyOn(current.worker, 'getPageReadingAnchorAtRevision');
    expect(anchorRead).toHaveBeenCalledWith({ revisionId: 'current', revisionVersion: 0 }, 1);
  });

  it('aborts an active candidate immediately and only lets the latest request commit', async () => {
    const current = currentFixture(2, 0);
    const first = createWorker(() => undefined, 'first');
    const latest = createWorker(() => undefined, 'latest');
    const workers = [first.worker, latest.worker];
    Object.assign(current.state, { workerFactory: () => workers.shift() ?? latest.worker });
    const firstStarted = createDeferred<undefined>();
    const firstCallback = vi.fn();
    const latestCallback = vi.fn();
    let firstSignal: AbortSignal | undefined;
    mocks.startCandidate.mockImplementationOnce(
      async (
        _state: BrowserReaderState,
        _owner: BrowserReaderBoundedSessionOwner,
        _request: unknown,
        signal?: AbortSignal,
      ) => {
        if (!signal) throw new Error('First candidate did not receive cancellation');
        firstSignal = signal;
        firstStarted.resolve(undefined);
        await aborted(signal);
        return undefined;
      },
    );
    mocks.startCandidate.mockImplementationOnce(
      (
        _state: BrowserReaderState,
        _owner: BrowserReaderBoundedSessionOwner,
        request: { readonly onCommitted?: (() => void) | undefined },
      ) => {
        request.onCommitted?.();
        return Promise.resolve(snapshot());
      },
    );

    scheduleBrowserReaderReflow(
      current.state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
      firstCallback,
    );
    await firstStarted.promise;
    scheduleBrowserReaderReflow(
      current.state,
      { ...BASE_READER_OPTIONS, width: 1000 },
      'single',
      'greedy',
      latestCallback,
    );
    await waitUntil(() => mocks.startCandidate.mock.calls.length === 2);

    expect(firstSignal?.aborted).toBe(true);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(latestCallback).toHaveBeenCalledOnce();
    expect(mocks.startCandidate.mock.calls[1]?.[2]).toMatchObject({
      config: { viewportWidth: 1000 },
    });
  });

  it('keeps the current exact revision when a candidate fails', async () => {
    const current = currentFixture(2, 0);
    const candidate = createWorker(() => undefined, 'failed');
    Object.assign(current.state, { workerFactory: () => candidate.worker });
    const previousHandle = current.state.revisionHandle;
    const previousBundle = current.state.revisionBundle;
    mocks.startCandidate.mockRejectedValueOnce(new Error('candidate failed'));

    scheduleBrowserReaderReflow(
      current.state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
    );
    await waitUntil(() => mocks.startCandidate.mock.calls.length === 1);
    await waitUntil(() => current.state.reflow.active === undefined);

    expect(current.state.boundedSessions.current).toBe(current.owner);
    expect(current.state.worker).toBe(current.worker);
    expect(current.state.revisionHandle).toBe(previousHandle);
    expect(current.state.revisionBundle).toBe(previousBundle);
    expect(current.state.reflow.lastError?.message).toContain('candidate failed');
    expect(current.state.logger.error).toHaveBeenCalledOnce();
  });

  it('retries with a fresh worker when the active spread moves during candidate commit', async () => {
    const current = currentFixture(3, 1);
    const stale = createWorker(() => undefined, 'stale-anchor');
    const retry = createWorker(() => undefined, 'retry-anchor');
    const workers = [stale.worker, retry.worker];
    Object.assign(current.state, { workerFactory: () => workers.shift() ?? retry.worker });
    mocks.startCandidate.mockImplementationOnce(() => {
      current.state.activeSpreadIndex = 2;
      return Promise.resolve(undefined);
    });
    mocks.startCandidate.mockResolvedValueOnce(snapshot());

    scheduleBrowserReaderReflow(
      current.state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
    );
    await waitUntil(() => mocks.startCandidate.mock.calls.length === 2);

    expect(mocks.openWorker).toHaveBeenCalledTimes(2);
    expect(mocks.startCandidate.mock.calls[0]?.[2]).toMatchObject({
      targetSpreadIndex: 1,
      expectedActiveSpreadIndex: 1,
    });
    expect(mocks.startCandidate.mock.calls[1]?.[2]).toMatchObject({
      targetSpreadIndex: 2,
      expectedActiveSpreadIndex: 2,
    });
  });

  it('cancels queued and active work, including the reader-dispose path', async () => {
    const current = currentFixture(2, 0);
    const candidate = createWorker(() => undefined, 'cancelled');
    Object.assign(current.state, { workerFactory: () => candidate.worker });
    const started = createDeferred<undefined>();
    let signal: AbortSignal | undefined;
    mocks.startCandidate.mockImplementationOnce(
      async (
        _state: BrowserReaderState,
        _owner: BrowserReaderBoundedSessionOwner,
        _request: unknown,
        input?: AbortSignal,
      ) => {
        if (!input) throw new Error('Candidate did not receive cancellation');
        signal = input;
        started.resolve(undefined);
        await aborted(input);
        return undefined;
      },
    );

    scheduleBrowserReaderReflow(
      current.state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
    );
    await started.promise;
    expect(current.state.pendingHostTasks.size).toBe(1);
    current.state.disposed = true;
    cancelBrowserReaderReflow(current.state);
    await waitUntil(() => current.state.reflow.active === undefined);

    expect(signal?.aborted).toBe(true);
    expect(current.state.pendingHostTasks.size).toBe(0);
    expect(current.state.reflow.queued).toBeUndefined();
    expect(current.state.boundedSessions.current).toBe(current.owner);

    const untouched = currentFixture(2, 0);
    Object.assign(untouched.state, { workerFactory: () => candidate.worker });
    scheduleBrowserReaderReflow(
      untouched.state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
    );
    cancelBrowserReaderReflow(untouched.state);
    await flushTasks();
    expect(mocks.startCandidate).toHaveBeenCalledTimes(1);
  });
});

function currentFixture(
  spreadCount: number,
  activeSpreadIndex: number,
): {
  readonly state: BrowserReaderState;
  readonly worker: BrowserReaderWorkerClient;
  readonly owner: BrowserReaderBoundedSessionOwner;
} {
  const fixture = createWorker(() => undefined, 'current');
  const state = createState(fixture.worker);
  const revision = revisionSummary('current', spreadCount, spreadCount);
  setRevisionState(state, revision);
  state.activeSpreadIndex = activeSpreadIndex;
  const currentOwner = owner(fixture.worker);
  recordBrowserReaderAcceptedRevision(currentOwner, revision);
  state.boundedSessions.current = currentOwner;
  return { state, worker: fixture.worker, owner: currentOwner };
}

function owner(worker: BrowserReaderWorkerClient): BrowserReaderBoundedSessionOwner {
  return {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      currentSnapshot: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(() => Promise.resolve()),
    },
    worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
}

function resolveAnchor(
  worker: BrowserReaderWorkerClient,
  spreadIndex: number,
  locator: ReaderLocator,
): void {
  vi.spyOn(worker, 'getPageReadingAnchorAtRevision').mockImplementation((revision, pageIndex) =>
    Promise.resolve({
      revision,
      value: {
        status: 'resolved',
        revisionId: revision.revisionId,
        pageIndex,
        spreadIndex,
        locator,
      },
    }),
  );
}

function sourceLocator(href: string, offset: number): ReaderLocator {
  return {
    href,
    sourcePoint: { nodePath: [0], textOffset: offset },
  };
}

function snapshot(): BrowserReaderBoundedSnapshot {
  return {} as BrowserReaderBoundedSnapshot;
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for bounded reflow test condition');
}

async function flushTasks(): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
