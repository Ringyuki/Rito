import type { ChapterRange, LayoutConfig, ReaderScrollLayout, Spread } from '../../../reader';
import type { BrowserReaderNavigationResult } from '../reader-session';
import { sessionReaderWindowLength } from './layout-options';
import type { SessionReaderPublication } from './publication';

export type SessionReaderRevisionLayout = Extract<
  BrowserReaderNavigationResult,
  { readonly kind: 'layout' }
>['layout'];

/** What a committed layout covers: the chapter being read, or the whole book. */
export type SessionReaderLayoutScope = 'chapter' | 'book';

/** One revision's page table in the terms a reader exposes. */
export interface SessionReaderLayoutView {
  readonly scope: SessionReaderLayoutScope;
  readonly pageCount: number;
  readonly spreads: readonly Spread[];
  /** The pages of each chapter the revision lays out, by spine idref. */
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  /** The page each placed TOC entry lands on, by the engine's TOC id. */
  readonly tocPageById: ReadonlyMap<number, number>;
  /** Per page, the TOC id of the entry it reads under. */
  readonly activeTocIdByPage: readonly (number | undefined)[];
  /** Per page, the spread that draws it. */
  readonly spreadIndexByPage: readonly (number | undefined)[];
  /** Per page, the manifest href of the chapter it belongs to. */
  readonly chapterHrefByPage: readonly (string | undefined)[];
  /** Whether it holds every page: while a window is resized, only the pages laid out so far. */
  readonly complete: boolean;
  /** A scrolled revision's windows; absent for pages. */
  readonly scroll: ReaderScrollLayout | undefined;
}

export function createSessionReaderLayoutView(
  layout: SessionReaderRevisionLayout,
  scope: SessionReaderLayoutScope,
  publication: SessionReaderPublication,
  config: LayoutConfig,
): SessionReaderLayoutView {
  const spreadIndexByPage = new Array<number | undefined>(layout.pageCount).fill(undefined);
  const spreads = layout.spreads.map((pages, index): Spread => {
    spreadIndexByPage[pages.leftPageIndex] = index;
    if (pages.rightPageIndex === undefined) {
      return { index, pageIndexes: [pages.leftPageIndex], leftPageIndex: pages.leftPageIndex };
    }
    spreadIndexByPage[pages.rightPageIndex] = index;
    return {
      index,
      pageIndexes: [pages.leftPageIndex, pages.rightPageIndex],
      leftPageIndex: pages.leftPageIndex,
      rightPageIndex: pages.rightPageIndex,
    };
  });
  const chapterMap = new Map<string, ChapterRange>();
  const chapterHrefByPage = new Array<string | undefined>(layout.pageCount).fill(undefined);
  for (const chapter of layout.chapters) {
    const idref = publication.spineIdrefs[chapter.spineIndex];
    if (idref === undefined) continue;
    chapterMap.set(idref, { startPage: chapter.startPage, endPage: chapter.endPage });
    chapterHrefByPage.fill(
      publication.manifestHrefMap.get(idref),
      chapter.startPage,
      chapter.endPage + 1,
    );
  }
  return {
    scope,
    pageCount: layout.pageCount,
    spreads,
    chapterMap,
    tocPageById: new Map(layout.tocTargets.map((target) => [target.tocId, target.pageIndex])),
    activeTocIdByPage: layout.activeTocEntryByPage,
    spreadIndexByPage,
    chapterHrefByPage,
    complete: layout.complete,
    scroll: scrollLayout(layout, config, spreadIndexByPage),
  };
}

/** A scrolled revision's chapters by the spreads of their windows; undefined for pages. */
function scrollLayout(
  layout: SessionReaderRevisionLayout,
  config: LayoutConfig,
  spreadIndexByPage: readonly (number | undefined)[],
): ReaderScrollLayout | undefined {
  if (layout.scrollAxis === undefined) return undefined;
  const chapters = layout.chapters.flatMap(({ startPage, endPage, extent }) => {
    const firstSpread = spreadIndexByPage[startPage];
    if (firstSpread === undefined || extent === undefined) return [];
    return [{ firstSpread, spreadCount: endPage - startPage + 1, extent }];
  });
  return {
    axis: layout.scrollAxis,
    windowLength: sessionReaderWindowLength(config, layout.scrollAxis),
    chapters: chapters.sort((first, second) => first.firstSpread - second.firstSpread),
  };
}

export const EMPTY_SESSION_READER_LAYOUT_VIEW: SessionReaderLayoutView = {
  scope: 'chapter',
  pageCount: 0,
  spreads: [],
  chapterMap: new Map(),
  tocPageById: new Map(),
  activeTocIdByPage: [],
  spreadIndexByPage: [],
  chapterHrefByPage: [],
  complete: true,
  scroll: undefined,
};
