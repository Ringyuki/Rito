import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBrowserReaderMethods } from '../../src/bindings/browser/reader/reader-methods';
import type { ReaderOptions } from '../../src/reader';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  createDeferred,
  createState as createCompleteState,
  createWorker,
} from './browser-reader-reflow-fixtures';
import type { BrowserReaderBoundedSessionOwner } from '../../src/bindings/browser/reader/types';

const mocks = vi.hoisted(() => ({
  scheduleBrowserReaderReflow: vi.fn(() => true),
  completeBrowserReaderBoundedSession: vi.fn(
    (): Promise<boolean | undefined> => Promise.resolve(true),
  ),
  ensureBrowserReaderBoundedLocator: vi.fn(() => Promise.resolve(undefined)),
  cancelBrowserReaderReflow: vi.fn(),
  disposeBrowserReaderPinnedFonts: vi.fn(),
  ensureFrameLoaded: vi.fn(),
  loadFrame: vi.fn(),
  preloadReaderFonts: vi.fn(() => Promise.resolve(false)),
  unregisterReaderFonts: vi.fn(),
  warmBrowserReaderFrameWindow: vi.fn(),
}));

vi.mock('../../src/bindings/browser/reader/pipeline/bounded-reflow', () => ({
  cancelBrowserReaderReflow: mocks.cancelBrowserReaderReflow,
  scheduleBrowserReaderReflow: mocks.scheduleBrowserReaderReflow,
}));

vi.mock('../../src/bindings/browser/bounded-session-runtime', () => ({
  completeBrowserReaderBoundedSession: mocks.completeBrowserReaderBoundedSession,
  ensureBrowserReaderBoundedLocator: mocks.ensureBrowserReaderBoundedLocator,
}));

vi.mock('../../src/bindings/browser/pinned-fonts', () => ({
  disposeBrowserReaderPinnedFonts: mocks.disposeBrowserReaderPinnedFonts,
}));

vi.mock('../../src/bindings/browser/reader/frame-cache', () => ({
  ensureFrameLoaded: mocks.ensureFrameLoaded,
  loadFrame: mocks.loadFrame,
  warmBrowserReaderFrameWindow: mocks.warmBrowserReaderFrameWindow,
}));

vi.mock('../../src/bindings/browser/resources', () => ({
  preloadReaderFonts: mocks.preloadReaderFonts,
  unregisterReaderFonts: mocks.unregisterReaderFonts,
  getImageObjectUrl: vi.fn(),
}));

describe('Browser reader methods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeBrowserReaderBoundedSession.mockResolvedValue(true);
    mocks.ensureBrowserReaderBoundedLocator.mockResolvedValue(undefined);
  });

  it('warms neighboring spreads when the active spread changes', () => {
    const state = createState();
    const methods = buildBrowserReaderMethods(state, readerOptions());

    methods.notifyActiveSpread(3);

    expect(mocks.warmBrowserReaderFrameWindow).toHaveBeenCalledWith(state, 3);
  });

  it('treats browser reader layout changes as asynchronous commits', () => {
    const state = createState();
    const methods = buildBrowserReaderMethods(state, readerOptions());

    expect(methods.updateLayout(900, 700, 'single')).toBe(false);
    expect(methods.setLineBreaking('optimal')).toBe(false);
    expect(methods.setTypography({ fontSize: 18 })).toBe(false);
    methods.resize(920, 720);

    expect(mocks.scheduleBrowserReaderReflow).toHaveBeenCalledTimes(4);
  });

  it('clears theme overrides when returning to the default theme', () => {
    const state = createState();
    const methods = buildBrowserReaderMethods(state, readerOptions());

    methods.setTheme({ backgroundColor: '#1a1a1a', foregroundColor: '#e0e0e0' });
    expect(state.bgColor).toBe('#1a1a1a');
    expect(state.fgColor).toBe('#e0e0e0');

    methods.setTheme({ backgroundColor: null, foregroundColor: null });
    expect(state.bgColor).toBe('#ffffff');
    expect(state.fgColor).toBeUndefined();
  });

  it('returns committed footnotes from browser reader state', () => {
    const state = createState();
    state.footnotes = new Map([
      ['chapter.xhtml#fn1', { kind: 'footnote', text: 'Note', html: '<p>Note</p>' }],
    ]);
    const methods = buildBrowserReaderMethods(state, readerOptions());

    expect(methods.getFootnotes().get('chapter.xhtml#fn1')?.text).toBe('Note');
  });

  it('returns committed chapter text indices from browser reader state', () => {
    const state = createState();
    state.chapterTextIndices = new Map([
      ['chapter', { href: 'chapter', normalizedText: 'Hello', spans: [] }],
    ]);
    const methods = buildBrowserReaderMethods(state, readerOptions());

    expect(methods.getChapterTextIndices().get('chapter')?.normalizedText).toBe('Hello');
  });

  it('forwards atomic locator navigation to bounded session growth', async () => {
    const state = createState();
    const methods = buildBrowserReaderMethods(state, readerOptions());
    const locator = { href: 'chapter.xhtml', sourcePoint: { nodePath: [1], textOffset: 2 } };
    const controller = new AbortController();

    await methods.navigateToLocator?.(locator, controller.signal);

    expect(mocks.ensureBrowserReaderBoundedLocator).toHaveBeenCalledWith(
      state,
      locator,
      controller.signal,
    );
  });

  it('binds search reads to the complete current revision handle', async () => {
    const state = createState();
    const revision = { revisionId: 'rev', revisionVersion: 3 };
    const searchAtRevision = vi.fn(() =>
      Promise.resolve({
        revision,
        value: {
          revisionId: revision.revisionId,
          query: 'needle',
          caseSensitive: false,
          wholeWord: false,
          resultCount: 0,
          results: [],
        },
      }),
    );
    state.worker = {
      sessionId: 'search-session',
      searchAtRevision,
    } as unknown as BrowserReaderState['worker'];
    state.revisionHandle = {
      workerSessionId: 'search-session',
      ...revision,
      commitGeneration: 4,
    };
    const methods = buildBrowserReaderMethods(state, readerOptions());

    await expect(methods.search?.('needle')).resolves.toEqual([]);

    expect(mocks.completeBrowserReaderBoundedSession).toHaveBeenCalledWith(state);
    expect(searchAtRevision).toHaveBeenCalledWith(revision, {
      query: 'needle',
      caseSensitive: false,
      wholeWord: false,
    });
    expect(mocks.completeBrowserReaderBoundedSession.mock.invocationCallOrder[0]).toBeLessThan(
      searchAtRevision.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('does not issue an exact search when bounded completion is cancelled', async () => {
    const state = createState();
    const searchAtRevision = vi.fn();
    state.worker = {
      sessionId: 'cancelled-search-session',
      searchAtRevision,
    } as unknown as BrowserReaderState['worker'];
    mocks.completeBrowserReaderBoundedSession.mockResolvedValueOnce(undefined);
    const methods = buildBrowserReaderMethods(state, readerOptions());

    await expect(methods.search?.('needle')).resolves.toEqual([]);

    expect(mocks.completeBrowserReaderBoundedSession).toHaveBeenCalledWith(state);
    expect(searchAtRevision).not.toHaveBeenCalled();
  });

  it('drops a delayed search result after the same session advances its version', async () => {
    const state = createState();
    const requested = { revisionId: 'rev', revisionVersion: 3 };
    let resolveSearch:
      | ((value: {
          readonly revision: typeof requested;
          readonly value: {
            readonly revisionId: string;
            readonly query: string;
            readonly caseSensitive: boolean;
            readonly wholeWord: boolean;
            readonly resultCount: number;
            readonly results: readonly [];
          };
        }) => void)
      | undefined;
    const searchAtRevision = vi.fn(
      () =>
        new Promise<Parameters<NonNullable<typeof resolveSearch>>[0]>((resolve) => {
          resolveSearch = resolve;
        }),
    );
    state.worker = {
      sessionId: 'search-session',
      searchAtRevision,
    } as unknown as BrowserReaderState['worker'];
    state.revisionHandle = {
      workerSessionId: 'search-session',
      ...requested,
      commitGeneration: 4,
    };
    const methods = buildBrowserReaderMethods(state, readerOptions());

    const pending = methods.search?.('needle');
    await vi.waitFor(() => {
      expect(searchAtRevision).toHaveBeenCalledOnce();
    });
    state.revisionHandle = {
      workerSessionId: 'search-session',
      revisionId: 'rev',
      revisionVersion: 4,
      commitGeneration: 5,
    };
    resolveSearch?.({
      revision: requested,
      value: {
        revisionId: 'rev',
        query: 'needle',
        caseSensitive: false,
        wholeWord: false,
        resultCount: 0,
        results: [],
      },
    });

    await expect(pending).resolves.toEqual([]);
  });

  it('aligns scaled canvas CSS dimensions to whole backing pixels', () => {
    const state = createState();
    state.dpr = 1.5;
    state.config = {
      ...state.config,
      viewportWidth: 800.5,
      viewportHeight: 600.25,
    };
    const methods = buildBrowserReaderMethods(state, readerOptions());

    const size = methods.getCanvasSize(1.2);

    expect(size).toEqual({ width: 1441 / state.dpr, height: 1080 / state.dpr });
    expect(size.width * state.dpr).toBe(1441);
    expect(size.height * state.dpr).toBe(1080);
  });

  it('disposes the reader-owned pinned font session', () => {
    const worker = createWorker(() => undefined);
    const state = createCompleteState(worker.worker);
    const methods = buildBrowserReaderMethods(state, readerOptions());

    methods.dispose();

    expect(mocks.cancelBrowserReaderReflow).toHaveBeenCalledWith(state);
    expect(mocks.disposeBrowserReaderPinnedFonts).toHaveBeenCalledWith(state.pinnedFonts);
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('drains bounded sessions before disposing their workers', async () => {
    const current = createWorker(() => undefined, 'current-bounded-worker');
    const candidate = createWorker(() => undefined, 'candidate-bounded-worker');
    const currentDrain = createDeferred<undefined>();
    const candidateDrain = createDeferred<undefined>();
    const state = createCompleteState(current.worker);
    state.boundedSessions.current = boundedOwner(current.worker, currentDrain.promise);
    state.boundedSessions.candidate = boundedOwner(candidate.worker, candidateDrain.promise);
    const methods = buildBrowserReaderMethods(state, readerOptions());

    methods.dispose();
    methods.dispose();

    expect(state.disposed).toBe(true);
    expect(state.boundedSessions).toEqual({ current: undefined, candidate: undefined });
    expect(current.dispose).not.toHaveBeenCalled();
    expect(candidate.dispose).not.toHaveBeenCalled();

    currentDrain.resolve(undefined);
    await Promise.resolve();
    expect(current.dispose).not.toHaveBeenCalled();
    candidateDrain.resolve(undefined);
    await state.disposeTask;

    expect(current.dispose).toHaveBeenCalledOnce();
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it('still closes workers when bounded cleanup rejects', async () => {
    const worker = createWorker(() => undefined, 'rejected-bounded-worker');
    const state = createCompleteState(worker.worker);
    state.boundedSessions.current = boundedOwner(
      worker.worker,
      Promise.reject(new Error('cleanup failed')),
    );
    const methods = buildBrowserReaderMethods(state, readerOptions());

    methods.dispose();
    await state.disposeTask;

    expect(state.logger.warn).toHaveBeenCalledWith(
      'bounded reader dispose failed',
      expect.objectContaining({ message: 'cleanup failed' }),
    );
    expect(worker.dispose).toHaveBeenCalledOnce();
  });
});

function boundedOwner(
  worker: BrowserReaderState['worker'],
  dispose: Promise<void>,
): BrowserReaderBoundedSessionOwner {
  return {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      currentSnapshot: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(() => dispose),
    },
    worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
}

function readerOptions(): ReaderOptions {
  return {
    width: 800,
    height: 600,
    margin: 40,
    spread: 'single',
    lineBreaking: 'greedy',
  };
}

function createState(): BrowserReaderState {
  return {
    lineBreaking: 'greedy',
    spreadMode: 'single',
    fontSizeOverride: undefined,
    lineHeightOverride: undefined,
    lineHeightForce: false,
    fontFamilyOverride: undefined,
    fontFamilyForce: false,
    config: {
      viewportWidth: 800,
      viewportHeight: 600,
      pageWidth: 720,
      pageHeight: 520,
      marginTop: 40,
      marginRight: 40,
      marginBottom: 40,
      marginLeft: 40,
      spreadMode: 'single',
      firstPageAlone: true,
      spreadGap: 20,
      rootFontSize: 16,
    },
    revisionBundle: {
      revision: {
        revisionId: 'rev',
        revisionVersion: 0,
        layoutKey: 'layout',
        status: 'complete',
        knownExtent: { pageCount: 0, spreadCount: 0 },
        finalExtent: { pageCount: 0, spreadCount: 0 },
        pageCount: 0,
        spreadCount: 0,
      },
      navigation: {
        revisionId: 'rev',
        pageCount: 0,
        spreadCount: 0,
        spreads: [],
        chapters: [],
        chapterMap: {},
      },
      tocTargets: { revisionId: 'rev', targets: [] },
      footnotes: { revisionId: 'rev', entries: {} },
      chapterTextIndices: { revisionId: 'rev', entries: {} },
      fontFamilies: [],
    },
    tocTargets: [],
    footnotes: new Map(),
    chapterTextIndices: new Map(),
    activeSpreadIndex: 0,
    boundedSessions: { current: undefined, candidate: undefined },
    disposeTask: undefined,
    spreadRenderedListeners: new Set(),
    spreadContentInvalidatedListeners: new Set(),
    layoutCommittedListeners: new Set(),
  } as unknown as BrowserReaderState;
}
