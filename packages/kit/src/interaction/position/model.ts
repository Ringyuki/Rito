import type { ReaderLocator, Spread } from '@ritojs/core';
import type { ChapterRange, ChapterTextIndex } from '../layout-types';
import type { SourcePoint } from '../anchors/model';

export interface ReadingLocator {
  readonly spineIdref: string;
  readonly manifestHref?: string;
  readonly chapterProgress: number;
  readonly sourcePoint?: SourcePoint;
}

export interface PositionLayout {
  readonly spreads: readonly Spread[];
  readonly pageCount: number;
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
  /** Canonical native source identity. Page and spread indices are revision-local projections. */
  readonly sourceLocator?: ReaderLocator;
  /** Spine-relative locator written by earlier releases; restore converts it to a source locator. */
  readonly locator?: ReadingLocator;
  readonly projection: PositionProjection;
  readonly progress: number;
  readonly timestamp: number;
}

export function createReadingPosition(
  layout: PositionLayout,
  spreadIndex: number,
): ReadingPosition {
  const { spreads } = layout;
  const clamped = Math.max(0, Math.min(spreadIndex, spreads.length - 1));
  const pageIndex = spreads[clamped]?.leftPageIndex ?? 0;
  const locator = createLocator(layout, pageIndex);
  const projection = { spreadIndex: clamped, pageIndex };
  const base = { projection, progress: progressForPage(pageIndex, layout), timestamp: Date.now() };
  return locator ? { ...base, locator } : base;
}

export function resolveReadingPosition(position: ReadingPosition, layout: PositionLayout): number {
  return projectReadingPosition(position, layout).projection.spreadIndex;
}

/** Project a position onto the current layout by chapter progress and spread index. */
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
  const resolvedPage = pageIndex ?? spreads[resolvedSpread]?.leftPageIndex ?? 0;
  return {
    ...position,
    projection: { spreadIndex: resolvedSpread, pageIndex: resolvedPage },
    progress: progressForPage(resolvedPage, layout),
    timestamp: Date.now(),
  };
}

export function progressForPage(pageIndex: number, layout: PositionLayout): number {
  return layout.pageCount > 0 ? pageIndex / layout.pageCount : 0;
}

function createLocator(layout: PositionLayout, pageIndex: number): ReadingLocator | undefined {
  const entry = findChapter(pageIndex, layout.chapterMap);
  if (!entry) return undefined;
  const [spineIdref, range] = entry;
  const pageSpan = Math.max(1, range.endPage - range.startPage);
  const chapterProgress = Math.min(1, Math.max(0, (pageIndex - range.startPage) / pageSpan));
  const manifestHref = layout.manifestHrefMap?.get(spineIdref);
  return {
    spineIdref,
    ...(manifestHref ? { manifestHref } : {}),
    chapterProgress,
  };
}

function resolvePositionPage(
  position: ReadingPosition,
  layout: PositionLayout,
): number | undefined {
  const locatorPage = position.locator ? resolveLocatorPage(position.locator, layout) : undefined;
  if (locatorPage !== undefined) return locatorPage;
  if (position.projection.pageIndex < layout.pageCount) return position.projection.pageIndex;
  const spread =
    layout.spreads[
      Math.max(0, Math.min(position.projection.spreadIndex, layout.spreads.length - 1))
    ];
  return spread?.leftPageIndex;
}

function resolveLocatorPage(locator: ReadingLocator, layout: PositionLayout): number | undefined {
  const range = layout.chapterMap.get(locator.spineIdref);
  if (!range) return undefined;
  const pageSpan = Math.max(0, range.endPage - range.startPage);
  const pageOffset = Math.round(Math.min(1, Math.max(0, locator.chapterProgress)) * pageSpan);
  return Math.max(range.startPage, Math.min(range.startPage + pageOffset, range.endPage));
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
  return spreads.find((spread) => spread.pageIndexes.includes(pageIndex))?.index;
}
