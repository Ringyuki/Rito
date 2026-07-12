import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserReaderRevisionResult,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import { scheduleBrowserReaderReflow } from '../../src/bindings/browser/reader/pipeline/reflow';
import {
  BASE_READER_OPTIONS,
  type Deferred,
  createDeferred,
  createState,
  createWorker,
  flushPromises,
  revisionResult,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Browser reader stale reflow races', () => {
  it('cancels an in-flight deferred full when returning to the canonical layout', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createViewRevision, releaseRevision, activeChapterPreview } = createWorker(
      (deferred) => pending.push(deferred),
    );
    const state = createReadyState(worker);
    state.activeSpreadIndex = 1;
    activeChapterPreview
      .mockResolvedValueOnce({ chapterIndex: 0, progress: 0 })
      .mockResolvedValueOnce(undefined);
    let staleCommits = 0;
    let canonicalCommits = 0;

    scheduleBrowserReaderReflow(
      state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
      () => {
        staleCommits += 1;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    state.activeSpreadIndex = 2;
    pending[0]?.resolve({ ...revisionResult('preview', 1, 1, 1), preview: true });
    await flushPromises();
    expect(state.visualPreview).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);

    expect(state.reflow.deferred).toBeDefined();
    expect(createViewRevision).toHaveBeenCalledTimes(2);
    expect(
      scheduleBrowserReaderReflow(state, BASE_READER_OPTIONS, 'single', 'greedy', () => {
        canonicalCommits += 1;
      }),
    ).toBe(true);
    expect(state.reflow.deferred).toBeUndefined();
    await flushPromises();
    expect(createViewRevision).toHaveBeenCalledTimes(3);

    pending[1]?.resolve(revisionResult('stale-full', 4, 4));
    await flushPromises();
    expect(releaseRevision).toHaveBeenCalledWith('stale-full');
    expect(state.revisionBundle.revision.revisionId).toBe('rev-ready');

    pending[2]?.resolve(revisionResult('canonical-full', 4, 4));
    await flushPromises();

    expect(state.revisionBundle.revision.revisionId).toBe('canonical-full');
    expect(state.config.viewportWidth).toBe(800);
    expect(staleCommits).toBe(0);
    expect(canonicalCommits).toBe(1);
  });

  it('continues with queued B without reporting a rejected active A', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createViewRevision } = createWorker((deferred) => pending.push(deferred));
    const state = createReadyState(worker);
    let staleCommits = 0;
    let latestCommits = 0;

    scheduleBrowserReaderReflow(
      state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
      () => {
        staleCommits += 1;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    scheduleBrowserReaderReflow(
      state,
      { ...BASE_READER_OPTIONS, width: 1000 },
      'single',
      'greedy',
      () => {
        latestCommits += 1;
      },
    );

    pending[0]?.reject(new Error('stale active failure'));
    await flushPromises();

    expect(createViewRevision).toHaveBeenCalledTimes(2);
    expect(state.reflow.lastError).toBeUndefined();
    expect(state.logger.error).not.toHaveBeenCalled();

    pending[1]?.resolve(revisionResult('latest-full', 4, 4));
    await flushPromises();

    expect(state.revisionBundle.revision.revisionId).toBe('latest-full');
    expect(state.config.viewportWidth).toBe(1000);
    expect(staleCommits).toBe(0);
    expect(latestCommits).toBe(1);
  });

  it('does not dispatch stale full work after the background worker opens', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', vi.fn());
    const foregroundPending: Deferred<BrowserReaderRevisionResult>[] = [];
    const foreground = createWorker((deferred) => foregroundPending.push(deferred));
    const background = createWorker(() => undefined);
    const state = createReadyState(foreground.worker);
    const backgroundOpen = createDeferred<Awaited<ReturnType<BrowserReaderWorkerClient['open']>>>();
    Object.assign(state, { workerFactory: () => background.worker });
    background.open.mockReturnValue(backgroundOpen.promise);
    foreground.activeChapterPreview
      .mockResolvedValueOnce({ chapterIndex: 0, progress: 0 })
      .mockResolvedValueOnce(undefined);

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await vi.advanceTimersByTimeAsync(0);
    foregroundPending[0]?.resolve({ ...revisionResult('preview', 1, 1), preview: true });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);

    expect(background.open).toHaveBeenCalledOnce();
    expect(background.createViewRevision).not.toHaveBeenCalled();
    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 1000 }, 'single', 'greedy');
    await flushPromises();

    backgroundOpen.resolve({
      publication: state.publication,
      pinnedFontPolicy: { schemaVersion: 1, policyId: '01'.repeat(32), faces: [] },
    });
    await flushPromises();
    expect(background.createViewRevision).not.toHaveBeenCalled();

    foregroundPending[1]?.resolve(revisionResult('latest-full', 4, 4));
    await flushPromises();
    expect(state.revisionBundle.revision.revisionId).toBe('latest-full');
  });

  it('releases a new revision when frame decoding fails before commit', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, releaseRevision } = createWorker((deferred) => pending.push(deferred));
    const state = createReadyState(worker);
    Object.assign(state, {
      decodeFrameCommandBuffer: vi.fn(() => {
        throw new Error('decode failed');
      }),
    });

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await vi.advanceTimersByTimeAsync(0);
    pending[0]?.resolve(revisionResult('decode-failure', 4, 4));
    await flushPromises();

    expect(releaseRevision).toHaveBeenCalledWith('decode-failure');
    expect(state.revisionBundle.revision.revisionId).toBe('rev-ready');
    expect(state.reflow.lastError?.message).toContain('queued reader reflow');
  });
});

function createReadyState(worker: BrowserReaderWorkerClient) {
  const state = createState(worker);
  setRevisionState(state, revisionSummary('rev-ready', 4, 4, 'ready'));
  return state;
}
