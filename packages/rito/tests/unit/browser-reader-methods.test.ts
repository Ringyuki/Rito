import { describe, expect, it, vi } from 'vitest';
import { buildBrowserReaderMethods } from '../../src/bindings/browser/reader/reader-methods';
import type { ReaderOptions } from '../../src/reader';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';

const mocks = vi.hoisted(() => ({
  scheduleBrowserReaderReflow: vi.fn(() => true),
  ensureFrameLoaded: vi.fn(),
  loadFrame: vi.fn(),
  preloadReaderFonts: vi.fn(() => Promise.resolve(false)),
  unregisterReaderFonts: vi.fn(),
  warmBrowserReaderFrameWindow: vi.fn(),
}));

vi.mock('../../src/bindings/browser/reader/pipeline/reflow', () => ({
  scheduleBrowserReaderReflow: mocks.scheduleBrowserReaderReflow,
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
});

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
      revision: { revisionId: 'rev', layoutKey: 'layout', pageCount: 0, spreadCount: 0 },
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
    spreadRenderedListeners: new Set(),
    spreadContentInvalidatedListeners: new Set(),
    layoutCommittedListeners: new Set(),
  } as unknown as BrowserReaderState;
}
