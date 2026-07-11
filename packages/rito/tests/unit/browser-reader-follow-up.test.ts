import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserReaderRevisionResult,
  BrowserReaderViewRevisionResult,
  BrowserReaderWorkerClient,
  CoreViewRevisionRequest,
} from '../../src/bindings/browser/core-contracts';
import { scheduleBrowserReaderReflow } from '../../src/bindings/browser/reader/pipeline/reflow';
import {
  BASE_READER_OPTIONS,
  type Deferred,
  createState,
  createWorker,
  flushPromises,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

afterEach(() => {
  vi.useRealTimers();
});

describe('Browser reader Rust follow-up dispatch', () => {
  it('uses runtime transport fields while retaining shared layout semantics', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, createViewRevision } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker);
    setRevisionState(state, {
      revisionId: 'rev-ready',
      layoutKey: 'ready',
      pageCount: 4,
      spreadCount: 4,
    });
    state.activeSpreadIndex = 1;
    let runtimeFollowUpRequest: CoreViewRevisionRequest | undefined;
    createViewRevision.mockImplementationOnce((previewRequest) => {
      const followUpRequest = {
        ...previewRequest,
        activeSpreadIndex: 99,
        previousRevisionId: 'runtime-parent',
        mode: 'full' as const,
      };
      runtimeFollowUpRequest = followUpRequest;
      const result = {
        kind: 'preview',
        display: 'visualPreview',
        followUp: { delayMs: 1000, request: followUpRequest },
        result: { ...revisionResult('runtime-preview', 1, 1, 1), preview: true },
      } satisfies BrowserReaderViewRevisionResult;
      return Promise.resolve(result);
    });
    let commits = 0;

    scheduleBrowserReaderReflow(
      state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
      () => {
        commits += 1;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    if (!runtimeFollowUpRequest) throw new Error('Expected a Rust follow-up request');
    state.activeSpreadIndex = 3;

    await vi.advanceTimersByTimeAsync(1000);

    expect(createViewRevision).toHaveBeenCalledTimes(2);
    expect(createViewRevision).toHaveBeenLastCalledWith({
      ...runtimeFollowUpRequest,
      activeSpreadIndex: 3,
    });
    expect(createRevision).toHaveBeenLastCalledWith(
      expect.objectContaining({ viewportWidth: 900 }),
      'greedy',
      3,
      'runtime-parent',
    );

    pending[0]?.resolve(revisionResult('runtime-full', 4, 4));
    await flushPromises();

    expect(state.config.viewportWidth).toBe(900);
    expect(state.lineBreaking).toBe('greedy');
    expect(state.revisionBundle.revision.revisionId).toBe('runtime-full');
    expect(commits).toBe(1);
  });
});

describe('Browser reader reflow races', () => {
  it('cancels an active resize when the latest request returns to the committed layout', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createViewRevision, releaseRevision } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createReadyState(worker);
    const resized = { ...BASE_READER_OPTIONS, width: 900 };
    let commits = 0;

    expect(scheduleBrowserReaderReflow(state, resized, 'single', 'greedy')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(createViewRevision).toHaveBeenCalledTimes(1);
    expect(scheduleBrowserReaderReflow(state, resized, 'single', 'greedy')).toBe(false);
    expect(
      scheduleBrowserReaderReflow(state, BASE_READER_OPTIONS, 'single', 'greedy', () => {
        commits += 1;
      }),
    ).toBe(true);

    pending[0]?.resolve(revisionResult('stale-resize', 4, 4));
    await flushPromises();

    expect(releaseRevision).toHaveBeenCalledWith('stale-resize');
    expect(createViewRevision).toHaveBeenCalledTimes(2);
    expect(createViewRevision.mock.lastCall?.[0].layoutConfig.viewportWidth).toBe(800);

    pending[1]?.resolve(revisionResult('canonical-layout', 4, 4));
    await flushPromises();

    expect(state.revisionBundle.revision.revisionId).toBe('canonical-layout');
    expect(state.config.viewportWidth).toBe(800);
    expect(commits).toBe(1);
  });

  it('discards a visual preview when navigation changes while it is in flight', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createViewRevision, releaseRevision, activeChapterPreview } = createWorker(
      (deferred) => pending.push(deferred),
    );
    const state = createReadyState(worker);
    state.activeSpreadIndex = 1;
    activeChapterPreview.mockResolvedValue({ chapterIndex: 0, progress: 0 });
    let commits = 0;

    scheduleBrowserReaderReflow(
      state,
      { ...BASE_READER_OPTIONS, width: 900 },
      'single',
      'greedy',
      () => {
        commits += 1;
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(createViewRevision.mock.lastCall?.[0].activeSpreadIndex).toBe(1);
    state.activeSpreadIndex = 2;

    pending[0]?.resolve({ ...revisionResult('stale-preview', 1, 1, 1), preview: true });
    await flushPromises();

    expect(releaseRevision).toHaveBeenCalledWith('stale-preview');
    expect(state.visualPreview).toBeUndefined();
    expect(state.reflow.deferred).toBeDefined();
    expect(createViewRevision).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(999);
    state.activeSpreadIndex = 3;
    await vi.advanceTimersByTimeAsync(1);
    expect(createViewRevision).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'full', activeSpreadIndex: 3 }),
    );

    pending[1]?.resolve(revisionResult('live-spread-full', 4, 4, 3));
    await flushPromises();

    expect(state.revisionBundle.revision.revisionId).toBe('live-spread-full');
    expect(commits).toBe(1);
  });

  it('ignores a deferred full error after a newer reflow commits', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createViewRevision, activeChapterPreview } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createReadyState(worker);
    activeChapterPreview
      .mockResolvedValueOnce({ chapterIndex: 0, progress: 0 })
      .mockResolvedValueOnce(undefined);

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await vi.advanceTimersByTimeAsync(0);
    pending[0]?.resolve({ ...revisionResult('preview', 1, 1), preview: true });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(createViewRevision).toHaveBeenCalledTimes(2);

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 1000 }, 'single', 'greedy');
    await flushPromises();
    pending[2]?.resolve(revisionResult('latest-full', 4, 4));
    await flushPromises();
    expect(state.revisionBundle.revision.revisionId).toBe('latest-full');

    pending[1]?.reject(new Error('stale deferred failure'));
    await flushPromises();

    expect(state.reflow.lastError).toBeUndefined();
    expect(state.logger.error).not.toHaveBeenCalled();
  });
});

function createReadyState(worker: BrowserReaderWorkerClient) {
  const state = createState(worker);
  setRevisionState(state, {
    revisionId: 'rev-ready',
    layoutKey: 'ready',
    pageCount: 4,
    spreadCount: 4,
  });
  return state;
}
