import { describe, expect, it } from 'vitest';
import type { Reader } from '../../src/reader';
import { defineBrowserReaderAccessors } from '../../src/bindings/browser/reader/reader';
import { resetBrowserReaderLayoutViewCache } from '../../src/bindings/browser/reader-layout';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { createState, createWorker, spreadNavigation } from './browser-reader-reflow-fixtures';

describe('Browser reader layout view cache', () => {
  it('returns stable accessor references while committed identities stay unchanged', () => {
    const { reader } = createFixture();
    const pages = reader.pages;
    const spreads = reader.spreads;
    const chapterMap = reader.chapterMap;
    const manifestHrefMap = reader.manifestHrefMap;

    expect(reader.pages).toBe(pages);
    expect(reader.spreads).toBe(spreads);
    expect(reader.chapterMap).toBe(chapterMap);
    expect(reader.manifestHrefMap).toBe(manifestHrefMap);
    expect(spreads[0]?.left).toBe(pages[0]);
  });

  it('invalidates pages and spreads when revision or config identity changes', () => {
    const { reader, state } = createFixture();
    const initial = captureViews(reader);

    state.revisionBundle = {
      ...state.revisionBundle,
      revision: {
        ...state.revisionBundle.revision,
        revisionVersion: state.revisionBundle.revision.revisionVersion + 1,
      },
    };
    const afterRevision = captureViews(reader);

    expect(afterRevision.pages).not.toBe(initial.pages);
    expect(afterRevision.spreads).not.toBe(initial.spreads);
    expect(afterRevision.chapterMap).toBe(initial.chapterMap);
    expect(afterRevision.manifestHrefMap).toBe(initial.manifestHrefMap);

    state.config = { ...state.config, pageWidth: state.config.pageWidth - 40 };
    const afterConfig = captureViews(reader);

    expect(afterConfig.pages).not.toBe(afterRevision.pages);
    expect(afterConfig.spreads).not.toBe(afterRevision.spreads);
    expect(afterConfig.chapterMap).toBe(afterRevision.chapterMap);
    expect(afterConfig.manifestHrefMap).toBe(afterRevision.manifestHrefMap);
    expect(afterConfig.pages[0]?.bounds.width).toBe(state.config.pageWidth);
  });

  it('invalidates only navigation and publication dependent views', () => {
    const { reader, state } = createFixture();
    const initial = captureViews(reader);
    state.revisionBundle = {
      ...state.revisionBundle,
      navigation: {
        ...state.revisionBundle.navigation,
        chapterMap: {
          chapter: { startPage: 0, endPage: 0, pageCount: 1, blockCount: 0 },
        },
      },
    };
    const afterNavigation = captureViews(reader);

    expect(afterNavigation.pages).toBe(initial.pages);
    expect(afterNavigation.spreads).not.toBe(initial.spreads);
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

    expect(afterPublication.pages).toBe(afterNavigation.pages);
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

    expect(afterReset.pages).not.toBe(initial.pages);
    expect(afterReset.spreads).not.toBe(initial.spreads);
    expect(afterReset.chapterMap).not.toBe(initial.chapterMap);
    expect(afterReset.manifestHrefMap).not.toBe(initial.manifestHrefMap);
  });
});

interface ReaderViews {
  readonly pages: Reader['pages'];
  readonly spreads: Reader['spreads'];
  readonly chapterMap: Reader['chapterMap'];
  readonly manifestHrefMap: Reader['manifestHrefMap'];
}

function captureViews(reader: Reader): ReaderViews {
  return {
    pages: reader.pages,
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
      status: 'complete',
      knownExtent: { pageCount: 2, spreadCount: 2 },
      finalExtent: { pageCount: 2, spreadCount: 2 },
      pageCount: 2,
      spreadCount: 2,
    },
    navigation: {
      revisionId: 'revision-1',
      pageCount: 2,
      spreadCount: 2,
      spreads: spreadNavigation(2),
      chapters: [],
      chapterMap: {
        chapter: { startPage: 0, endPage: 1, pageCount: 2, blockCount: 0 },
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
