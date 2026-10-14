import type { ChapterRange, Spread } from '../../../reader';
import type { BrowserReaderNavigationResult } from '../reader-session';
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
}

export function createSessionReaderLayoutView(
  layout: SessionReaderRevisionLayout,
  scope: SessionReaderLayoutScope,
  publication: SessionReaderPublication,
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
};
