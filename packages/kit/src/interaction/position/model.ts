import type { ChapterRange, Page, Spread } from '../layout-types';
import type { ChapterTextIndex } from '../anchors/chapter-text-index';
import type { SourcePoint } from '../anchors/model';
import { sourcePointToOffset } from '../anchors/source-point';
import { walkPageTextRuns } from '../core/text-traversal';

export interface ReadingLocator {
  readonly spineIdref: string;
  readonly manifestHref?: string;
  readonly chapterProgress: number;
  readonly sourcePoint?: SourcePoint;
}

export interface PositionLayout {
  readonly spreads: readonly Spread[];
  readonly pages: readonly Page[];
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  readonly manifestHrefMap?: ReadonlyMap<string, string>;
  readonly chapterTextIndices?: ReadonlyMap<string, ChapterTextIndex>;
}

export interface PositionProjection {
  readonly spreadIndex: number;
  readonly pageIndex: number;
}

/** A serializable source-anchored reading position plus its current layout projection. */
export interface ReadingPosition {
  readonly locator?: ReadingLocator;
  readonly projection: PositionProjection;
  readonly progress: number;
  readonly timestamp: number;
}

export function createReadingPosition(
  layout: PositionLayout,
  spreadIndex: number,
): ReadingPosition {
  const { spreads, pages } = layout;
  const clamped = Math.max(0, Math.min(spreadIndex, spreads.length - 1));
  const spread = spreads[clamped];
  const pageIndex = spread?.left?.index ?? spread?.right?.index ?? 0;
  const progress = pages.length > 0 ? pageIndex / pages.length : 0;
  const locator = createLocator(layout, pageIndex);
  const projection = { spreadIndex: clamped, pageIndex };
  const base = { projection, progress, timestamp: Date.now() };
  return locator ? { ...base, locator } : base;
}

export function resolveReadingPosition(position: ReadingPosition, layout: PositionLayout): number {
  return projectReadingPosition(position, layout).projection.spreadIndex;
}

/** Project a canonical source locator onto the current pagination. */
export function projectReadingPosition(
  position: ReadingPosition,
  layout: PositionLayout,
): ReadingPosition {
  const { spreads } = layout;
  if (spreads.length === 0) {
    return {
      ...position,
      projection: { spreadIndex: 0, pageIndex: 0 },
      progress: 0,
      timestamp: Date.now(),
    };
  }

  const pageIndex = resolvePositionPage(position, layout);
  const spreadIndex = pageIndex !== undefined ? findSpreadIndex(pageIndex, spreads) : undefined;
  const resolvedSpread =
    spreadIndex ?? Math.max(0, Math.min(position.projection.spreadIndex, spreads.length - 1));
  const resolvedPage = pageIndex ?? firstPageIndex(spreads[resolvedSpread]) ?? 0;
  const progress = layout.pages.length > 0 ? resolvedPage / layout.pages.length : 0;
  return {
    ...position,
    projection: { spreadIndex: resolvedSpread, pageIndex: resolvedPage },
    progress,
    timestamp: Date.now(),
  };
}

function createLocator(layout: PositionLayout, pageIndex: number): ReadingLocator | undefined {
  const entry = findChapter(pageIndex, layout.chapterMap);
  if (!entry) return undefined;
  const [spineIdref, range] = entry;
  const pageSpan = Math.max(1, range.endPage - range.startPage);
  const chapterProgress = Math.min(1, Math.max(0, (pageIndex - range.startPage) / pageSpan));
  const sourcePoint = findFirstSourcePoint(layout.pages[pageIndex]);
  const manifestHref = layout.manifestHrefMap?.get(spineIdref);
  return {
    spineIdref,
    ...(manifestHref ? { manifestHref } : {}),
    chapterProgress,
    ...(sourcePoint ? { sourcePoint } : {}),
  };
}

function resolvePositionPage(
  position: ReadingPosition,
  layout: PositionLayout,
): number | undefined {
  const locatorPage = position.locator ? resolveLocatorPage(position.locator, layout) : undefined;
  if (locatorPage !== undefined) return locatorPage;
  if (layout.pages[position.projection.pageIndex]) return position.projection.pageIndex;
  const spread =
    layout.spreads[
      Math.max(0, Math.min(position.projection.spreadIndex, layout.spreads.length - 1))
    ];
  return firstPageIndex(spread);
}

function resolveLocatorPage(locator: ReadingLocator, layout: PositionLayout): number | undefined {
  const range = layout.chapterMap.get(locator.spineIdref);
  if (!range) return undefined;

  const sourcePage = locator.sourcePoint
    ? resolveSourcePointPage(locator, layout, range)
    : undefined;
  if (sourcePage !== undefined) return sourcePage;

  const pageSpan = Math.max(0, range.endPage - range.startPage);
  const pageOffset = Math.round(Math.min(1, Math.max(0, locator.chapterProgress)) * pageSpan);
  return Math.max(range.startPage, Math.min(range.startPage + pageOffset, range.endPage));
}

function resolveSourcePointPage(
  locator: ReadingLocator,
  layout: PositionLayout,
  range: ChapterRange,
): number | undefined {
  if (!locator.sourcePoint) return undefined;
  const chapterIndex = layout.chapterTextIndices?.get(locator.spineIdref);
  if (!chapterIndex) return undefined;
  const offset = sourcePointToOffset(chapterIndex, locator.sourcePoint);
  if (offset === undefined) return undefined;

  let fallback: number | undefined;
  for (let pageIndex = range.startPage; pageIndex <= range.endPage; pageIndex++) {
    const bounds = sourceOffsetBounds(layout.pages[pageIndex], chapterIndex);
    if (!bounds) continue;
    fallback = pageIndex;
    if (offset <= bounds.end) return pageIndex;
  }
  return fallback;
}

function sourceOffsetBounds(
  page: Page | undefined,
  chapterIndex: ChapterTextIndex,
): { start: number; end: number } | undefined {
  if (!page) return undefined;
  let start = Infinity;
  let end = -Infinity;
  walkPageTextRuns(page, ({ run }) => {
    if (!run.sourceRef) return false;
    const offset = sourcePointToOffset(chapterIndex, {
      nodePath: run.sourceRef.nodePath,
      textOffset: run.sourceTextOffset ?? 0,
    });
    if (offset === undefined) return false;
    start = Math.min(start, offset);
    end = Math.max(end, offset + run.text.length);
    return false;
  });
  return start === Infinity ? undefined : { start, end };
}

function firstPageIndex(spread: Spread | undefined): number | undefined {
  return spread?.left?.index ?? spread?.right?.index;
}

function findFirstSourcePoint(page: Page | undefined): SourcePoint | undefined {
  if (!page) return undefined;
  let point: SourcePoint | undefined;
  walkPageTextRuns(page, ({ run }) => {
    if (!run.sourceRef) return false;
    point = {
      nodePath: run.sourceRef.nodePath,
      textOffset: run.sourceTextOffset ?? 0,
    };
    return true;
  });
  return point;
}

function findChapter(
  pageIndex: number,
  chapterMap: ReadonlyMap<string, ChapterRange>,
): [string, ChapterRange] | undefined {
  for (const entry of chapterMap) {
    const [, range] = entry;
    if (pageIndex >= range.startPage && pageIndex <= range.endPage) return entry;
  }
  return undefined;
}

function findSpreadIndex(pageIndex: number, spreads: readonly Spread[]): number | undefined {
  for (const spread of spreads) {
    if (spread.left?.index === pageIndex || spread.right?.index === pageIndex) return spread.index;
  }
  return undefined;
}
