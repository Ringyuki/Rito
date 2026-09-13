import { describe, expect, it } from 'vitest';
import type { Reader } from '../../src/reader';
import { defineBrowserReaderAccessors } from '../../src/bindings/browser/reader/reader';
import { resetBrowserReaderLayoutViewCache } from '../../src/bindings/browser/reader-layout';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { createState, createWorker, spreadNavigationSlot } from './browser-reader-reflow-fixtures';

describe('Browser reader layout view cache', () => {
  it('projects the latest committed active spread', () => {
    const { reader, state } = createFixture();
    state.activeSpreadIndex = 1;

    expect(reader.activeSpreadIndex).toBe(1);

    state.activeSpreadIndex = 0;
    expect(reader.activeSpreadIndex).toBe(0);
  });

  it('projects whole-book counts and the navigation record of every spread', () => {
    const { reader } = createFixture();

    expect(reader.totalSpreads).toBe(2);
    expect(reader.pageCount).toBe(3);
    expect(reader.spreads).toEqual([
      { index: 0, pageIndexes: [0], leftPageIndex: 0 },
      { index: 1, pageIndexes: [1, 2], leftPageIndex: 1, rightPageIndex: 2 },
    ]);
    expect(reader.spreads[0]).not.toHaveProperty('rightPageIndex');
  });

  it('returns stable accessor references while committed identities stay unchanged', () => {
    const { reader } = createFixture();
    const spreads = reader.spreads;
    const chapterMap = reader.chapterMap;
    const manifestHrefMap = reader.manifestHrefMap;

    expect(reader.spreads).toBe(spreads);
    expect(reader.chapterMap).toBe(chapterMap);
    expect(reader.manifestHrefMap).toBe(manifestHrefMap);
  });

  it('keeps every view across revision and config identity changes', () => {
    const { reader, state } = createFixture();
    const initial = captureViews(reader);

    state.revisionBundle = {
      ...state.revisionBundle,
      revision: {
        ...state.revisionBundle.revision,
        revisionVersion: state.revisionBundle.revision.revisionVersion + 1,
      },
    };
    state.config = { ...state.config, pageWidth: state.config.pageWidth - 40 };
    const after = captureViews(reader);

    expect(after.spreads).toBe(initial.spreads);
    expect(after.chapterMap).toBe(initial.chapterMap);
    expect(after.manifestHrefMap).toBe(initial.manifestHrefMap);
  });

  it('invalidates only navigation and publication dependent views', () => {
    const { reader, state } = createFixture();
    const initial = captureViews(reader);
    state.revisionBundle = {
      ...state.revisionBundle,
      navigation: {
        ...state.revisionBundle.navigation,
        pageCount: 1,
        spreads: [spreadNavigationSlot(0, 0)],
        chapterMap: {
          chapter: { startPage: 0, endPage: 0, pageCount: 1, blockCount: 0 },
        },
      },
    };
    const afterNavigation = captureViews(reader);

    expect(afterNavigation.spreads).not.toBe(initial.spreads);
    expect(afterNavigation.spreads).toEqual([{ index: 0, pageIndexes: [0], leftPageIndex: 0 }]);
    expect(reader.pageCount).toBe(1);
    expect(afterNavigation.chapterMap).not.toBe(initial.chapterMap);
    expect(afterNavigation.manifestHrefMap).toBe(initial.manifestHrefMap);
    expect(afterNavigation.chapterMap.get('chapter')).toEqual({ startPage: 0, endPage: 0 });

    replacePublication(state, {
      ...state.publication,
      package: {
        ...state.publication.package,
        manifest: [
          {
            id: 'chapter',
            href: 'updated.xhtml',
            mediaType: 'application/xhtml+xml',
          },
        ],
      },
    });
    const afterPublication = captureViews(reader);

    expect(afterPublication.spreads).toBe(afterNavigation.spreads);
    expect(afterPublication.chapterMap).toBe(afterNavigation.chapterMap);
    expect(afterPublication.manifestHrefMap).not.toBe(afterNavigation.manifestHrefMap);
    expect(afterPublication.manifestHrefMap.get('chapter')).toBe('updated.xhtml');
  });

  it('releases all materialized views when the reader cache is reset', () => {
    const { reader, state } = createFixture();
    const initial = captureViews(reader);

    resetBrowserReaderLayoutViewCache(state);
    const afterReset = captureViews(reader);

    expect(afterReset.spreads).not.toBe(initial.spreads);
    expect(afterReset.chapterMap).not.toBe(initial.chapterMap);
    expect(afterReset.manifestHrefMap).not.toBe(initial.manifestHrefMap);
  });
});

interface ReaderViews {
  readonly spreads: Reader['spreads'];
  readonly chapterMap: Reader['chapterMap'];
  readonly manifestHrefMap: Reader['manifestHrefMap'];
}

function captureViews(reader: Reader): ReaderViews {
  return {
    spreads: reader.spreads,
    chapterMap: reader.chapterMap,
    manifestHrefMap: reader.manifestHrefMap,
  };
}

function createFixture(): { readonly reader: Reader; readonly state: BrowserReaderState } {
  const state = createState(createWorker(() => undefined).worker, {
    package: {
      metadata: { title: 'Cache fixture', language: 'en', identifier: 'cache-fixture' },
      manifest: [{ id: 'chapter', href: 'chapter.xhtml', mediaType: 'application/xhtml+xml' }],
      spine: [{ idref: 'chapter', linear: true }],
      toc: [],
    },
  });
  state.revisionBundle = {
    ...state.revisionBundle,
    revision: {
      revisionId: 'revision-1',
      revisionVersion: 1,
      layoutKey: 'layout-1',
      pageCount: 3,
      spreadCount: 2,
    },
    navigation: {
      revisionId: 'revision-1',
      pageCount: 3,
      spreadCount: 2,
      spreads: [spreadNavigationSlot(0, 0), spreadNavigationSlot(1, 1, 2)],
      chapters: [],
      chapterMap: {
        chapter: { startPage: 0, endPage: 2, pageCount: 3, blockCount: 0 },
      },
    },
  };
  const partial: Partial<Reader> = {};
  defineBrowserReaderAccessors(partial, state);
  return { reader: partial as Reader, state };
}

function replacePublication(
  state: BrowserReaderState,
  publication: BrowserReaderState['publication'],
): void {
  Object.defineProperty(state, 'publication', { configurable: true, value: publication });
}
