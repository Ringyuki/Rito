import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserReaderRevisionResult,
  CoreSourceLocator,
} from '../../src/bindings/browser/core-contracts';
import { scheduleBrowserReaderReflow } from '../../src/bindings/browser/reader/pipeline/reflow';
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
  spreadNavigationSlot,
} from './browser-reader-reflow-fixtures';

afterEach(() => {
  vi.useRealTimers();
});

describe('Browser reader portable reflow anchors', () => {
  it('captures the active page source locator before dispatching a replacement view', async () => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    state.activeSpreadIndex = 1;
    const locator = sourceLocator(12);
    fixture.getPageReadingAnchorAtRevision.mockResolvedValue(versionedAnchor(1, 1, locator));

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await flushPromises();

    expect(fixture.getPageReadingAnchorAtRevision).toHaveBeenCalledWith(handle(), 1);
    expect(fixture.createViewRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSpreadIndex: 1,
        previousRevisionId: 'rev-ready',
        preserveLocator: locator,
      }),
    );
    expect(fixture.createViewRevision.mock.lastCall?.[0].preserveLocator).not.toBe(locator);

    pending[0]?.resolve(revisionResult('replacement', 3, 3));
    await flushPromises();
  });

  it('recaptures when navigation changes while the source read is in flight', async () => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    state.activeSpreadIndex = 1;
    const oldRead =
      createDeferred<Awaited<ReturnType<typeof fixture.worker.getPageReadingAnchorAtRevision>>>();
    const latestLocator = sourceLocator(24);
    fixture.getPageReadingAnchorAtRevision
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(versionedAnchor(2, 2, latestLocator));

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await flushPromises();
    expect(fixture.createViewRevision).not.toHaveBeenCalled();

    state.activeSpreadIndex = 2;
    oldRead.resolve(versionedAnchor(1, 1, sourceLocator(12)));
    await flushPromises();

    expect(fixture.getPageReadingAnchorAtRevision).toHaveBeenNthCalledWith(1, handle(), 1);
    expect(fixture.getPageReadingAnchorAtRevision).toHaveBeenNthCalledWith(2, handle(), 2);
    expect(fixture.createViewRevision).toHaveBeenCalledOnce();
    expect(fixture.createViewRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSpreadIndex: 2,
        preserveLocator: latestLocator,
      }),
    );

    pending[0]?.resolve(revisionResult('latest', 3, 3));
    await flushPromises();
  });

  it('does not dispatch a superseded layout after its anchor read settles', async () => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    const oldRead =
      createDeferred<Awaited<ReturnType<typeof fixture.worker.getPageReadingAnchorAtRevision>>>();
    fixture.getPageReadingAnchorAtRevision
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValue(versionedAnchor(0, 0, sourceLocator(20)));

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await flushPromises();
    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 1000 }, 'single', 'greedy');
    oldRead.resolve(versionedAnchor(0, 0, sourceLocator(10)));
    await flushPromises();
    await flushPromises();

    expect(fixture.createViewRevision).toHaveBeenCalledOnce();
    const request = fixture.createViewRevision.mock.lastCall?.[0];
    expect(request?.layoutConfig.viewportWidth).toBe(1000);
    expect(request?.preserveLocator).toEqual(sourceLocator(20));
    pending[0]?.resolve(revisionResult('latest', 3, 3));
    await flushPromises();
  });

  it('does not invent a preserve locator when the native page is unavailable', async () => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    fixture.getPageReadingAnchorAtRevision.mockResolvedValue({
      revision: handle(),
      value: {
        status: 'unavailable',
        revisionId: 'rev-ready',
        pageIndex: 0,
        spreadIndex: 0,
        reason: 'noSourceContent',
      },
    });

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await flushPromises();

    const request = fixture.createViewRevision.mock.lastCall?.[0];
    expect(request).toBeDefined();
    expect(request).not.toHaveProperty('preserveLocator');
    pending[0]?.resolve(revisionResult('fallback', 3, 3));
    await flushPromises();
  });

  it('uses the first resolved page anchor in a double-page spread', async () => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = createState(fixture.worker);
    setRevisionState(state, revisionSummary('rev-ready', 3, 2, 'ready'), {
      revisionId: 'rev-ready',
      pageCount: 3,
      spreadCount: 2,
      spreads: [spreadNavigationSlot(0, 0), spreadNavigationSlot(1, 1, 2)],
      chapters: [],
      chapterMap: {},
    });
    state.activeSpreadIndex = 1;
    const locator = sourceLocator(32);
    fixture.getPageReadingAnchorAtRevision
      .mockResolvedValueOnce({
        revision: handle(),
        value: {
          status: 'unavailable',
          revisionId: 'rev-ready',
          pageIndex: 1,
          spreadIndex: 1,
          reason: 'noSourceContent',
        },
      })
      .mockResolvedValueOnce(versionedAnchor(2, 1, locator));

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'double', 'greedy');
    await flushPromises();

    expect(fixture.getPageReadingAnchorAtRevision).toHaveBeenNthCalledWith(1, handle(), 1);
    expect(fixture.getPageReadingAnchorAtRevision).toHaveBeenNthCalledWith(2, handle(), 2);
    expect(fixture.createViewRevision).toHaveBeenCalledWith(
      expect.objectContaining({ activeSpreadIndex: 1, preserveLocator: locator }),
    );

    pending[0]?.resolve(revisionResult('replacement', 3, 2));
    await flushPromises();
  });

  it('publishes the frame spread selected by Rust with the committed revision', async () => {
    vi.useFakeTimers();
    const pending: ReturnType<typeof createDeferred<BrowserReaderRevisionResult>>[] = [];
    const fixture = createWorker((deferred) => pending.push(deferred));
    const state = readyState(fixture.worker);
    state.activeSpreadIndex = 1;
    fixture.getPageReadingAnchorAtRevision.mockResolvedValue(
      versionedAnchor(1, 1, sourceLocator(12)),
    );
    const committedSpreads: number[] = [];
    state.layoutCommittedListeners.add((spreadIndex) => committedSpreads.push(spreadIndex));

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await flushPromises();
    pending[0]?.resolve(revisionWithSelectedSpread('replacement', 3));
    await flushPromises();

    expect(state.revisionBundle.revision.revisionId).toBe('replacement');
    expect(state.activeSpreadIndex).toBe(3);
    expect(committedSpreads).toEqual([3]);
  });
});

function readyState(worker: ReturnType<typeof createWorker>['worker']) {
  const state = createState(worker);
  setRevisionState(state, revisionSummary('rev-ready', 4, 4, 'ready'));
  return state;
}

function handle() {
  return { revisionId: 'rev-ready', revisionVersion: 0 };
}

function sourceLocator(textOffset: number): CoreSourceLocator {
  return {
    href: 'Text/chapter.xhtml',
    sourcePoint: { nodePath: [0, 1], textOffset },
    progression: textOffset / 100,
  };
}

function versionedAnchor(pageIndex: number, spreadIndex: number, locator: CoreSourceLocator) {
  return {
    revision: handle(),
    value: {
      status: 'resolved' as const,
      revisionId: 'rev-ready',
      pageIndex,
      spreadIndex,
      locator,
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
