import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBrowserReaderInitialReflow } from '../../src/bindings/browser/reader/pipeline/reflow';
import type {
  BrowserReaderRevisionResult,
  BrowserReaderViewRevisionResult,
} from '../../src/bindings/browser/core-contracts';
import {
  BASE_READER_OPTIONS,
  type Deferred,
  createDeferred,
  createState,
  createWorker,
  flushPromises,
  revisionResult,
} from './browser-reader-reflow-fixtures';

type FullViewRevisionRequest = NonNullable<BrowserReaderViewRevisionResult['followUp']>['request'];

afterEach(() => {
  vi.useRealTimers();
});

describe('Browser reader initial font metric reflow', () => {
  it('rebuilds a full initial revision when host metrics arrive after its first layout', async () => {
    vi.useFakeTimers();
    const fixture = createWorker(() => undefined);
    const state = createState(fixture.worker);
    let revision = 0;
    fixture.createViewRevision.mockImplementation(() => {
      revision += 1;
      const result: BrowserReaderViewRevisionResult = {
        kind: 'full',
        display: 'revision',
        result: { ...revisionResult(`rev-${String(revision)}`, 1, 1), preview: false },
      };
      return Promise.resolve(result);
    });

    await startBrowserReaderInitialReflow(
      state,
      BASE_READER_OPTIONS,
      'single',
      'greedy',
      undefined,
      undefined,
      () => {
        addTitleMetrics(state);
        return Promise.resolve(true);
      },
    );
    expect(fixture.createViewRevision).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();

    const refreshedRequest = fixture.createViewRevision.mock.calls[1]?.[0];
    expect(fixture.createViewRevision).toHaveBeenCalledTimes(2);
    expect(refreshedRequest?.previousRevisionId).toBe('rev-1');
    expect(refreshedRequest?.layoutConfig.fontFamilyAdvances).toEqual({
      title: { ' ': 0.25 },
    });
    expect(state.revisionBundle.revision.revisionId).toBe('rev-2');
  });

  it('refreshes the visible preview before deferring full layout', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = createState(fixture.worker);
    fixture.activeChapterPreview.mockResolvedValue({ chapterIndex: 0, progress: 0 });
    const initial = startBrowserReaderInitialReflow(
      state,
      BASE_READER_OPTIONS,
      'single',
      'greedy',
      undefined,
      undefined,
      () => {
        addTitleMetrics(state);
        return Promise.resolve(true);
      },
    );

    pending[0]?.resolve({ ...revisionResult('preview-1', 1, 1), preview: true });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.createRevision).toHaveBeenCalledTimes(2);

    pending[1]?.resolve({ ...revisionResult('preview-2', 1, 1), preview: true });
    await initial;
    await flushPromises();

    const refreshedConfig = fixture.createRevision.mock.calls[1]?.[0];
    expect(state.revisionBundle.revision.revisionId).toBe('preview-1');
    expect(state.visualPreview?.revision.revisionId).toBe('preview-2');
    expect(state.reflow.deferred?.followUp.request.layoutConfig.fontFamilyAdvances).toEqual({
      title: { ' ': 0.25 },
    });
    expect(refreshedConfig?.fontFamilyAdvances).toEqual({ title: { ' ': 0.25 } });
  });

  it('keeps a newer deferred reflow when stale initial font loading fails', async () => {
    vi.useFakeTimers();
    const fixture = createWorker(() => undefined);
    const state = createState(fixture.worker);
    const fontGate = createDeferred<boolean>();
    let followUpRequest: FullViewRevisionRequest | undefined;
    fixture.createViewRevision.mockImplementationOnce((request) => {
      followUpRequest = {
        ...request,
        mode: 'full',
        previousRevisionId: 'preview-1',
      };
      return Promise.resolve({
        kind: 'preview',
        display: 'revision',
        followUp: { delayMs: 1_000, request: followUpRequest },
        result: { ...revisionResult('preview-1', 1, 1), preview: true },
      });
    });

    await startBrowserReaderInitialReflow(
      state,
      BASE_READER_OPTIONS,
      'single',
      'greedy',
      undefined,
      undefined,
      () => fontGate.promise,
    );
    await vi.advanceTimersByTimeAsync(0);
    if (!followUpRequest) throw new Error('Expected initial follow-up request');
    const currentDeferred: NonNullable<typeof state.reflow.deferred> = {
      request: {
        config: state.config,
        spreadMode: 'single' as const,
        lineBreaking: 'greedy' as const,
        token: ++state.reflow.token,
      },
      followUp: {
        delayMs: 500,
        request: { ...followUpRequest, activeSpreadIndex: 1 },
      },
    };
    state.reflow.deferred = currentDeferred;

    fontGate.reject(new Error('stale font load failed'));
    await flushPromises();

    expect(state.reflow.deferred).toBe(currentDeferred);
    expect(state.reflow.lastError).toBeUndefined();
  });

  it('reports a current font failure and still schedules the original full follow-up', async () => {
    vi.useFakeTimers();
    const fixture = createWorker(() => undefined);
    const state = createState(fixture.worker);
    const fontGate = createDeferred<boolean>();
    fixture.createViewRevision.mockImplementationOnce((request) =>
      Promise.resolve({
        kind: 'preview',
        display: 'revision',
        followUp: {
          delayMs: 1_000,
          request: { ...request, mode: 'full', previousRevisionId: 'preview-1' },
        },
        result: { ...revisionResult('preview-1', 1, 1), preview: true },
      }),
    );

    await startBrowserReaderInitialReflow(
      state,
      BASE_READER_OPTIONS,
      'single',
      'greedy',
      undefined,
      undefined,
      () => fontGate.promise,
    );
    await vi.advanceTimersByTimeAsync(0);
    fontGate.reject(new Error('font probe failed'));
    await flushPromises();

    expect(state.reflow.lastError?.message).toContain('initial reader font reflow failed');
    expect(state.reflow.deferred?.followUp.request.mode).toBe('full');
  });
});

function addTitleMetrics(state: ReturnType<typeof createState>): void {
  state.fontMetrics.fontFamilies['title'] = {
    advances: { ' ': 0.25 },
    pairAdjustments: {},
  };
}
