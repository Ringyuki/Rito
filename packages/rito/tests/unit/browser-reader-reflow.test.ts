import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  scheduleBrowserReaderReflow,
  startBrowserReaderInitialReflow,
} from '../../src/bindings/browser/reader/pipeline/reflow';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import type { BrowserReaderRevisionResult } from '../../src/bindings/browser/core-contracts';
import {
  BASE_READER_OPTIONS,
  type Deferred,
  chapterNavigation,
  createState,
  createWorker,
  flushPromises,
  frameBuffer,
  revisionResult,
  setRevisionState,
  spreadNavigation,
  spreadNavigationSlot,
} from './browser-reader-reflow-fixtures';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Browser reader reflow scheduling', () => {
  it('keeps one worker pagination active and commits only the latest queued layout', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, releaseRevision } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker);
    let commits = 0;

    expect(scheduleBrowserReaderReflow(state, BASE_READER_OPTIONS, 'single', 'greedy')).toBe(true);
    await flushPromises();
    expect(createRevision).toHaveBeenCalledTimes(1);

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    scheduleBrowserReaderReflow(
      state,
      { ...BASE_READER_OPTIONS, width: 1000 },
      'single',
      'greedy',
      () => {
        commits += 1;
      },
    );
    expect(createRevision).toHaveBeenCalledTimes(1);

    pending[0]?.resolve(revisionResult('rev-1', 1, 1));
    await flushPromises();
    expect(createRevision).toHaveBeenCalledTimes(2);
    expect(releaseRevision).toHaveBeenCalledWith('rev-1');

    pending[1]?.resolve({
      ...revisionResult('rev-2', 2, 2),
      bundle: {
        ...revisionResult('rev-2', 2, 2).bundle,
        chapterTextIndices: {
          revisionId: 'rev-2',
          entries: {
            chapter: {
              href: 'chapter',
              normalizedText: 'Committed',
              spans: [
                {
                  nodePath: [0],
                  sourceStart: 0,
                  sourceEnd: 9,
                  normalizedStart: 0,
                  normalizedEnd: 9,
                },
              ],
            },
          },
        },
      },
    });
    await flushPromises();
    expect(state.revisionBundle.revision.revisionId).toBe('rev-2');
    expect(state.config.viewportWidth).toBe(1000);
    expect(state.revisionBundle.revision.pageCount).toBe(2);
    expect(state.revisionBundle.revision.spreadCount).toBe(2);
    expect(state.chapterTextIndices.get('chapter')?.normalizedText).toBe('Committed');
    expect(commits).toBe(1);
  });

  it('records queued reflow failures instead of swallowing them invisibly', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision } = createWorker((deferred) => pending.push(deferred));
    const state = createState(worker);
    setRevisionState(state, {
      revisionId: 'rev-ready',
      layoutKey: 'ready',
      pageCount: 1,
      spreadCount: 1,
    });

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await vi.advanceTimersByTimeAsync(0);
    expect(createRevision).toHaveBeenCalledTimes(1);

    pending[0]?.reject(new Error('pagination failed'));
    await flushPromises();

    expect(state.reflow.lastError?.message).toContain('queued reader reflow');
    expect(state.logger.error).toHaveBeenCalledWith(
      'queued reader reflow failed',
      state.reflow.lastError,
    );
    expect(state.reflow.active).toBe(false);
  });

  it('rejects the initial reflow when no visible revision exists', async () => {
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker } = createWorker((deferred) => pending.push(deferred));
    const state = createState(worker);
    const reflow = scheduleInitialReflowPromise(state);

    pending[0]?.reject(new Error('open pagination failed'));

    await expect(reflow).rejects.toThrow('initial reader reflow');
    expect(state.reflow.lastError?.message).toContain('initial reader reflow');
    expect(state.reflow.active).toBe(false);
  });

  it('debounces reflow requests after a revision is already visible', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision } = createWorker((deferred) => pending.push(deferred));
    const state = createState(worker);
    setRevisionState(state, {
      revisionId: 'rev-ready',
      layoutKey: 'ready',
      pageCount: 1,
      spreadCount: 1,
    });

    expect(
      scheduleBrowserReaderReflow(
        state,
        { ...BASE_READER_OPTIONS, width: 900 },
        'single',
        'greedy',
      ),
    ).toBe(true);
    expect(createRevision).not.toHaveBeenCalled();
    expect(state.config.viewportWidth).toBe(800);

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 1000 }, 'single', 'greedy');
    await vi.advanceTimersByTimeAsync(0);
    expect(createRevision).toHaveBeenCalledTimes(1);
    pending[0]?.resolve(revisionResult('rev-2', 2, 2));
    await flushPromises();
    expect(state.revisionBundle.revision.revisionId).toBe('rev-2');
    expect(state.config.viewportWidth).toBe(1000);
  });

  it('delegates active-preview eligibility to the runtime instead of chapter count', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, activeChapterPreview } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker, {
      chapters: [{ idref: 'c1', href: 'c1.xhtml', linear: true, textLength: 1, textHash: 'c1' }],
    });
    setRevisionState(
      state,
      { revisionId: 'rev-ready', layoutKey: 'ready', pageCount: 1, spreadCount: 1 },
      {
        revisionId: 'rev-ready',
        pageCount: 1,
        spreadCount: 1,
        spreads: spreadNavigation(1),
        chapters: [chapterNavigation('c1', 0, 0)],
        chapterMap: {},
      },
    );
    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await vi.advanceTimersByTimeAsync(0);

    expect(activeChapterPreview).toHaveBeenCalledWith('rev-ready', 0);
    expect(createRevision).toHaveBeenCalledTimes(1);
    expect(createRevision).toHaveBeenLastCalledWith(expect.any(Object), 'greedy', 0, 'rev-ready');

    pending[0]?.resolve({ ...revisionResult('full', 1, 1), preview: false });
    await flushPromises();
    expect(state.revisionBundle.revision.revisionId).toBe('full');
  });

  it('commits a first-chapter preview before deferred full initial revision', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision } = createWorker((deferred) => pending.push(deferred));
    const state = createState(worker);
    let previewCommits = 0;
    let fullCommits = 0;

    scheduleInitialReflow(
      state,
      BASE_READER_OPTIONS,
      'single',
      'greedy',
      () => {
        previewCommits += 1;
      },
      () => {
        fullCommits += 1;
      },
    );

    expect(createRevision).toHaveBeenCalledWith(expect.any(Object), 'greedy', 0);
    pending[0]?.resolve({ ...revisionResult('preview', 1, 1), preview: true });
    await flushPromises();

    expect(state.revisionBundle.revision.revisionId).toBe('preview');
    expect(previewCommits).toBe(1);
    expect(createRevision).toHaveBeenCalledTimes(1);
    expect(fullCommits).toBe(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(createRevision).toHaveBeenCalledTimes(2);
    expect(createRevision).toHaveBeenLastCalledWith(expect.any(Object), 'greedy', 0, 'preview');
  });

  it('uses a revision-bundled initial frame without an extra worker frame request', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, warmFrameWindow } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker);

    scheduleInitialReflow(state, BASE_READER_OPTIONS, 'single', 'greedy');
    expect(createRevision).toHaveBeenCalledTimes(1);

    pending[0]?.resolve({
      ...revisionResult('preview', 1, 1),
      frameWindow: {
        plan: {
          revisionId: 'preview',
          centerSpreadIndex: 0,
          displaySpreadIndex: 0,
          spreadIndexes: [0],
        },
        frames: [frameBuffer('preview', 0)],
        spreads: [{ spreadIndex: 0, resources: [] }],
      },
      preview: true,
    });
    await flushPromises();

    expect(warmFrameWindow).not.toHaveBeenCalled();
    expect(state.frames.has(0)).toBe(true);
  });

  it('uses a revision-bundled frame window before falling back to a worker frame request', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, warmFrameWindow } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker);

    scheduleInitialReflow(state, BASE_READER_OPTIONS, 'single', 'greedy');
    expect(createRevision).toHaveBeenCalledTimes(1);

    pending[0]?.resolve({
      ...revisionResult('preview', 1, 1),
      frameWindow: {
        plan: {
          revisionId: 'preview',
          centerSpreadIndex: 0,
          displaySpreadIndex: 0,
          spreadIndexes: [0],
        },
        frames: [frameBuffer('preview', 0)],
        spreads: [{ spreadIndex: 0, resources: [] }],
      },
      preview: true,
    });
    await flushPromises();

    expect(warmFrameWindow).not.toHaveBeenCalled();
    expect(state.frames.has(0)).toBe(true);
  });

  it('caches the bundled frame window before layout commit listeners run', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker } = createWorker((deferred) => pending.push(deferred));
    const state = createState(worker);
    let adjacentFrameCachedAtCommit = false;
    state.layoutCommittedListeners.add(() => {
      adjacentFrameCachedAtCommit = state.frames.has(1);
    });

    scheduleInitialReflow(state, BASE_READER_OPTIONS, 'single', 'greedy');
    pending[0]?.resolve({
      ...revisionResult('preview', 2, 2),
      frameWindow: {
        plan: {
          revisionId: 'preview',
          centerSpreadIndex: 0,
          displaySpreadIndex: 0,
          spreadIndexes: [0, 1],
        },
        frames: [frameBuffer('preview', 0), frameBuffer('preview', 1)],
        spreads: [
          { spreadIndex: 0, resources: [] },
          { spreadIndex: 1, resources: [] },
        ],
      },
      preview: true,
    });
    await flushPromises();

    expect(adjacentFrameCachedAtCommit).toBe(true);
    expect(state.frames.has(1)).toBe(true);
  });

  it('commits the initial preview frame selected by the runtime bundle', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, warmFrameWindow } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker);

    scheduleInitialReflow(state, BASE_READER_OPTIONS, 'single', 'greedy');
    pending[0]?.resolve({
      ...revisionResult('preview', 3, 3),
      frameSelection: { spreadIndex: 2, displaySpreadIndex: 2 },
      selectedFrame: {
        spreadIndex: 2,
        displaySpreadIndex: 2,
        frame: frameBuffer('preview', 2),
      },
      frameWindow: {
        plan: {
          revisionId: 'preview',
          centerSpreadIndex: 2,
          displaySpreadIndex: 2,
          spreadIndexes: [2],
        },
        frames: [frameBuffer('preview', 2)],
        spreads: [{ spreadIndex: 2, resources: [] }],
      },
      preview: true,
    });
    await flushPromises();

    expect(createRevision).toHaveBeenCalledWith(expect.any(Object), 'greedy', 0);
    expect(warmFrameWindow).not.toHaveBeenCalled();
    expect(state.frames.has(0)).toBe(false);
    expect(state.frames.has(2)).toBe(true);
  });

  it('ignores no-op resize requests while the initial preview revision is in flight', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision } = createWorker((deferred) => pending.push(deferred));
    const state = createState(worker);

    scheduleInitialReflow(state, BASE_READER_OPTIONS, 'single', 'greedy');
    expect(createRevision).toHaveBeenCalledTimes(1);

    expect(scheduleBrowserReaderReflow(state, BASE_READER_OPTIONS, 'single', 'greedy')).toBe(false);
    expect(state.reflow.queued).toBeUndefined();

    pending[0]?.resolve({ ...revisionResult('preview', 1, 1), preview: true });
    await flushPromises();

    expect(state.revisionBundle.revision.revisionId).toBe('preview');
    expect(createRevision).toHaveBeenCalledTimes(1);
  });

  it('lets resize preview cancel deferred full initial reflow before it starts', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, activeChapterPreview } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker, {
      chapters: [
        { idref: 'c1', href: 'c1.xhtml', linear: true, textLength: 1, textHash: 'c1' },
        { idref: 'c2', href: 'c2.xhtml', linear: true, textLength: 1, textHash: 'c2' },
      ],
    });

    scheduleInitialReflow(state, BASE_READER_OPTIONS, 'single', 'greedy');
    pending[0]?.resolve({ ...revisionResult('preview', 1, 1), preview: true });
    await flushPromises();
    setRevisionState(state, state.revisionBundle.revision, {
      revisionId: 'preview',
      pageCount: 1,
      spreadCount: 1,
      spreads: spreadNavigation(1),
      chapters: [chapterNavigation('c1', 0, 0), chapterNavigation('c2', 1, 1)],
      chapterMap: {},
    });
    activeChapterPreview.mockResolvedValue({ chapterIndex: 0, progress: 0 });

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await vi.advanceTimersByTimeAsync(0);

    expect(createRevision).toHaveBeenCalledTimes(2);
    expect(createRevision).toHaveBeenLastCalledWith(expect.any(Object), 'greedy', 0, 'preview');
  });

  it('commits an active-chapter window revision before deferred full resize reflow', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, activeChapterPreview } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker, {
      chapters: [
        { idref: 'c1', href: 'c1.xhtml', linear: true, textLength: 1, textHash: 'c1' },
        { idref: 'c2', href: 'c2.xhtml', linear: true, textLength: 1, textHash: 'c2' },
        { idref: 'c3', href: 'c3.xhtml', linear: true, textLength: 1, textHash: 'c3' },
      ],
    });
    setRevisionState(
      state,
      { revisionId: 'rev-ready', layoutKey: 'ready', pageCount: 4, spreadCount: 4 },
      {
        revisionId: 'rev-ready',
        pageCount: 4,
        spreadCount: 4,
        spreads: spreadNavigation(4),
        chapters: [
          chapterNavigation('c1', 0, 0),
          chapterNavigation('c2', 1, 2),
          chapterNavigation('c3', 3, 3),
        ],
        chapterMap: {},
      },
    );
    state.activeSpreadIndex = 1;
    activeChapterPreview.mockResolvedValue({ chapterIndex: 1, progress: 0 });
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

    expect(createRevision).toHaveBeenCalledWith(expect.any(Object), 'greedy', 1, 'rev-ready');
    pending[0]?.resolve({
      ...revisionResult('preview', 2, 2, 1),
      preview: true,
    });
    await flushPromises();

    expect(state.revisionBundle.revision.revisionId).toBe('rev-ready');
    expect(state.revisionBundle.revision.spreadCount).toBe(4);
    expect(state.visualPreview?.revisionId).toBe('preview');
    expect(state.visualPreview?.spreadIndex).toBe(1);
    expect(commits).toBe(0);
    expect(createRevision).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(createRevision).toHaveBeenCalledTimes(2);
    expect(createRevision).toHaveBeenLastCalledWith(expect.any(Object), 'greedy', 1, 'rev-ready');

    pending[1]?.resolve({ ...revisionResult('full', 4, 4), preview: false });
    await flushPromises();
    expect(state.revisionBundle.revision.revisionId).toBe('full');
    expect(state.visualPreview).toBeUndefined();
    expect(commits).toBe(1);
  });

  it('does not treat active chapter resize preview as a standalone cover spread', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, activeChapterPreview } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker, {
      chapters: [
        { idref: 'c1', href: 'c1.xhtml', linear: true, textLength: 1, textHash: 'c1' },
        { idref: 'c2', href: 'c2.xhtml', linear: true, textLength: 1, textHash: 'c2' },
      ],
    });
    setRevisionState(
      state,
      { revisionId: 'rev-ready', layoutKey: 'ready', pageCount: 5, spreadCount: 3 },
      {
        revisionId: 'rev-ready',
        pageCount: 5,
        spreadCount: 3,
        spreads: [
          spreadNavigationSlot(0, 0),
          spreadNavigationSlot(1, 1, 2),
          spreadNavigationSlot(2, 3, 4),
        ],
        chapters: [chapterNavigation('c1', 0, 0), chapterNavigation('c2', 1, 4)],
        chapterMap: {},
      },
    );
    state.activeSpreadIndex = 1;
    activeChapterPreview.mockResolvedValue({ chapterIndex: 1, progress: 0 });

    scheduleBrowserReaderReflow(
      state,
      { ...BASE_READER_OPTIONS, width: 1000, height: 600, spread: 'double' },
      'double',
      'greedy',
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(createRevision).toHaveBeenCalledTimes(1);
    expect(createRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadMode: 'double',
        firstPageAlone: true,
      }),
      'greedy',
      1,
      'rev-ready',
    );
  });

  it('does not let an in-flight deferred full reflow block a newer resize preview', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, activeChapterPreview } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker, {
      chapters: [
        { idref: 'c1', href: 'c1.xhtml', linear: true, textLength: 1, textHash: 'c1' },
        { idref: 'c2', href: 'c2.xhtml', linear: true, textLength: 1, textHash: 'c2' },
      ],
    });
    setRevisionState(
      state,
      { revisionId: 'rev-ready', layoutKey: 'ready', pageCount: 3, spreadCount: 3 },
      {
        revisionId: 'rev-ready',
        pageCount: 3,
        spreadCount: 3,
        spreads: spreadNavigation(3),
        chapters: [chapterNavigation('c1', 0, 0), chapterNavigation('c2', 1, 2)],
        chapterMap: {},
      },
    );
    state.activeSpreadIndex = 1;
    activeChapterPreview.mockResolvedValue({ chapterIndex: 1, progress: 0 });

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await flushPromises();
    pending[0]?.resolve({
      ...revisionResult('preview', 1, 1, 1),
      preview: true,
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(1000);
    expect(createRevision).toHaveBeenCalledTimes(2);
    expect(state.reflow.active).toBe(false);

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 1000 }, 'single', 'greedy');
    await flushPromises();
    expect(createRevision).toHaveBeenCalledTimes(3);
    expect(createRevision).toHaveBeenLastCalledWith(expect.any(Object), 'greedy', 1, 'rev-ready');
  });

  it('invalidates only the current spread when committing an active resize preview', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, activeChapterPreview } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker, {
      chapters: [
        { idref: 'c1', href: 'c1.xhtml', linear: true, textLength: 1, textHash: 'c1' },
        { idref: 'c2', href: 'c2.xhtml', linear: true, textLength: 1, textHash: 'c2' },
      ],
    });
    setRevisionState(
      state,
      { revisionId: 'rev-ready', layoutKey: 'ready', pageCount: 5, spreadCount: 5 },
      {
        revisionId: 'rev-ready',
        pageCount: 5,
        spreadCount: 5,
        spreads: spreadNavigation(5),
        chapters: [chapterNavigation('c1', 0, 1), chapterNavigation('c2', 2, 4)],
        chapterMap: {},
      },
    );
    state.activeSpreadIndex = 3;
    activeChapterPreview.mockResolvedValue({ chapterIndex: 1, progress: 0.5 });
    const invalidated: number[] = [];
    let layoutCommits = 0;
    state.spreadContentInvalidatedListeners.add((index) => invalidated.push(index));
    state.layoutCommittedListeners.add(() => {
      layoutCommits += 1;
    });

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await vi.advanceTimersByTimeAsync(0);
    pending[0]?.resolve({
      ...revisionResult('preview', 1, 1, 3),
      preview: true,
    });
    await flushPromises();

    expect(createRevision).toHaveBeenCalledTimes(1);
    expect(state.revisionBundle.revision.revisionId).toBe('rev-ready');
    expect(state.revisionBundle.revision.spreadCount).toBe(5);
    expect(state.visualPreview?.config.viewportWidth).toBe(900);
    expect(state.visualPreview?.spreadIndex).toBe(3);
    expect(state.visualPreview?.frame.spreadIndex).toBe(0);
    expect(invalidated).toEqual([3]);
    expect(layoutCommits).toBe(0);
  });

  it('hands preview and full revisions back and forth between two workers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', vi.fn());
    const foregroundPending: Deferred<BrowserReaderRevisionResult>[] = [];
    const backgroundPending: Deferred<BrowserReaderRevisionResult>[] = [];
    const foreground = createWorker((deferred) => foregroundPending.push(deferred));
    const background = createWorker((deferred) => backgroundPending.push(deferred));
    background.activeChapterPreview.mockResolvedValue({ chapterIndex: 0, progress: 0 });
    const state = createState(foreground.worker);
    state.fullReflowWorker = background.worker;
    state.fullReflowOpenPromise = Promise.resolve();

    const initialReflow = startBrowserReaderInitialReflow(
      state,
      BASE_READER_OPTIONS,
      'single',
      'greedy',
    );
    foregroundPending[0]?.resolve({
      ...revisionResult('initial-preview', 1, 1),
      preview: true,
    });
    await initialReflow;

    expect(state.worker).toBe(foreground.worker);
    await vi.advanceTimersByTimeAsync(1000);
    expect(background.createViewRevision).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'full' }),
    );
    backgroundPending[0]?.resolve(revisionResult('background-full', 2, 2));
    await flushPromises();

    expect(state.worker).toBe(background.worker);
    expect(foreground.releaseRevision).toHaveBeenCalledWith('initial-preview');

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await flushPromises();
    expect(background.createViewRevision).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'preview',
        previousRevisionId: 'background-full',
      }),
    );
    backgroundPending[1]?.resolve({
      ...revisionResult('resize-preview', 1, 1),
      preview: true,
    });
    await flushPromises();

    expect(state.worker).toBe(background.worker);
    expect(state.visualPreview?.revisionId).toBe('resize-preview');

    await vi.advanceTimersByTimeAsync(1000);
    expect(foreground.createViewRevision).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'full' }),
    );
    expect(foreground.createViewRevision.mock.lastCall?.[0]).not.toHaveProperty(
      'previousRevisionId',
    );
    foregroundPending[1]?.resolve(revisionResult('foreground-full', 3, 3));
    await flushPromises();

    expect(state.worker).toBe(foreground.worker);
    expect(state.revisionBundle.revision.revisionId).toBe('foreground-full');
    expect(state.visualPreview).toBeUndefined();
    expect(background.releaseRevision).toHaveBeenCalledWith('resize-preview');
    expect(background.releaseRevision).toHaveBeenCalledWith('background-full');
    expect(background.dispose).toHaveBeenCalledOnce();
  });

  it('does not keep a stale deferred full reflow when returning to canonical layout', async () => {
    vi.useFakeTimers();
    const pending: Deferred<BrowserReaderRevisionResult>[] = [];
    const { worker, createRevision, activeChapterPreview } = createWorker((deferred) =>
      pending.push(deferred),
    );
    const state = createState(worker, {
      chapters: [
        { idref: 'c1', href: 'c1.xhtml', linear: true, textLength: 1, textHash: 'c1' },
        { idref: 'c2', href: 'c2.xhtml', linear: true, textLength: 1, textHash: 'c2' },
      ],
    });
    setRevisionState(
      state,
      { revisionId: 'rev-ready', layoutKey: 'ready', pageCount: 5, spreadCount: 5 },
      {
        revisionId: 'rev-ready',
        pageCount: 5,
        spreadCount: 5,
        spreads: spreadNavigation(5),
        chapters: [chapterNavigation('c1', 0, 1), chapterNavigation('c2', 2, 4)],
        chapterMap: {},
      },
    );
    state.activeSpreadIndex = 3;
    activeChapterPreview.mockResolvedValue({ chapterIndex: 1, progress: 0.5 });

    scheduleBrowserReaderReflow(state, { ...BASE_READER_OPTIONS, width: 900 }, 'single', 'greedy');
    await flushPromises();
    pending[0]?.resolve({
      ...revisionResult('preview', 1, 1, 3),
      preview: true,
    });
    await flushPromises();
    expect(state.visualPreview?.config.viewportWidth).toBe(900);
    if (!state.visualPreview) throw new Error('Expected active visual preview');
    state.reflow.deferred = {
      request: {
        config: state.visualPreview.config,
        spreadMode: 'single',
        lineBreaking: 'greedy',
        token: state.reflow.token,
      },
      followUp: { mode: 'full', delayMs: 1000, previousRevisionId: 'rev-ready' },
    };

    expect(scheduleBrowserReaderReflow(state, BASE_READER_OPTIONS, 'single', 'greedy')).toBe(true);
    expect(state.reflow.deferred).toBeUndefined();
    await flushPromises();

    expect(createRevision).toHaveBeenCalledTimes(2);
    expect(createRevision).toHaveBeenLastCalledWith(expect.any(Object), 'greedy', 3, 'rev-ready');
  });
});

function scheduleInitialReflow(
  state: BrowserReaderState,
  options = BASE_READER_OPTIONS,
  spreadMode: 'single' | 'double' = 'single',
  lineBreaking: 'greedy' | 'optimal' = 'greedy',
  onPreviewCommitted?: () => void,
  onFullCommitted?: () => void,
): void {
  void startBrowserReaderInitialReflow(
    state,
    options,
    spreadMode,
    lineBreaking,
    onPreviewCommitted,
    onFullCommitted,
  ).catch(() => undefined);
}

function scheduleInitialReflowPromise(state: BrowserReaderState): Promise<void> {
  return startBrowserReaderInitialReflow(state, BASE_READER_OPTIONS, 'single', 'greedy');
}
