import { buildHitMap } from '../../interaction/core/hit-map';
import type { HitEntry } from '../../interaction/core/types';
import { sourcePointToOffset } from '../../interaction/anchors/source-point';
import type { ChapterTextIndex } from '../../interaction/anchors/chapter-text-index';
import type { SpineItem } from '../../parser/epub/types';
import type { ChapterRange, PaginationResult } from '../types';
import { findSpreadForPage, resolveHrefPageLocation, type HrefPageLocation } from '../navigation';
import { createReaderSessionError } from './errors';
import type { ReaderRevisionRecord } from './revision';
import type { ReaderLocator, ReaderSessionId, ResolvedLocator } from './types';

export interface ResolveReaderLocatorInput {
  readonly sessionId: ReaderSessionId;
  readonly record: ReaderRevisionRecord;
  readonly locator: ReaderLocator;
  readonly spine: readonly SpineItem[];
  readonly manifestHrefs: ReadonlyMap<string, string>;
}

export function resolveReaderLocator(input: ResolveReaderLocatorInput): ResolvedLocator {
  if (input.locator.sourceRange) {
    return resolveSourceRangeLocator(input);
  }
  if (input.locator.text) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'not-supported',
      'Text locators are not supported yet',
    );
  }

  const internal = resolveInternalLocator(input.record, input.locator);
  if (internal) return toResolvedLocator(input.record, input.locator, internal);
  if (isInternalLocatorHref(input.locator.href)) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'not-found',
      `Internal locator ${input.locator.href} is not available`,
    );
  }

  return resolvePublicationHrefLocator(input);
}

function resolveSourceRangeLocator(input: ResolveReaderLocatorInput): ResolvedLocator {
  const range = input.locator.sourceRange;
  if (!range || !isValidSourceRange(range.start, range.end)) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'bad-request',
      'Source-range locator is invalid',
    );
  }
  const pagination = requirePagination(input);
  const pageIndex = resolveSourceRangePage(input, pagination, range);
  const spreadIndex = findSpreadForPage(pageIndex, input.record.spreads);
  if (spreadIndex === undefined) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'not-found',
      `No spread contains page ${String(pageIndex)}`,
    );
  }
  return toResolvedLocator(input.record, input.locator, { pageIndex, spreadIndex });
}

function resolveSourceRangePage(
  input: ResolveReaderLocatorInput,
  pagination: PaginationResult,
  range: { readonly start: number; readonly end: number },
): number {
  const location = requireSourceRangeLocation(input, pagination);
  const chapterIndex = pagination.chapterTextIndices.get(location.spineIdref);
  const chapterRange = pagination.chapterMap.get(location.spineIdref);
  if (!chapterIndex || !chapterRange || range.end > chapterIndex.normalizedText.length) {
    sourceRangeUnavailable(input);
  }
  const pageIndex = findPageForSourceRange(pagination, chapterRange, chapterIndex, range);
  if (pageIndex !== undefined) return pageIndex;
  throw createReaderSessionError(
    input.sessionId,
    input.record.revision.id,
    'not-found',
    `Source range for ${input.locator.href} is not on a paginated spread`,
  );
}

function requireSourceRangeLocation(
  input: ResolveReaderLocatorInput,
  pagination: PaginationResult,
): HrefPageLocation {
  const location = resolveHrefPageLocation(
    input.locator.href,
    pagination.chapterMap,
    input.spine,
    input.manifestHrefs,
    pagination.anchorMap,
    {
      allowMissingAnchorFallback: false,
      chapterAnchorMap: pagination.chapterAnchorMap,
    },
  );
  if (location) return location;
  throw createReaderSessionError(
    input.sessionId,
    input.record.revision.id,
    input.locator.href.includes('#') ? 'not-found' : 'not-supported',
    `Locator ${input.locator.href} cannot be resolved`,
  );
}

function sourceRangeUnavailable(input: ResolveReaderLocatorInput): never {
  throw createReaderSessionError(
    input.sessionId,
    input.record.revision.id,
    'not-found',
    `Source range for ${input.locator.href} is not available`,
  );
}

function resolveInternalLocator(
  record: ReaderRevisionRecord,
  locator: ReaderLocator,
): { readonly pageIndex: number; readonly spreadIndex: number } | undefined {
  const pageIndex = parseInternalIndex(locator.href, 'page:');
  if (pageIndex !== undefined) {
    const spreadIndex = findSpreadForPage(pageIndex, record.spreads);
    return spreadIndex === undefined ? undefined : { pageIndex, spreadIndex };
  }

  const spreadIndex = parseInternalIndex(locator.href, 'spread:');
  if (spreadIndex === undefined) return undefined;
  const spread = record.spreads[spreadIndex];
  const firstPage = spread?.left ?? spread?.right;
  return firstPage ? { pageIndex: firstPage.index, spreadIndex } : undefined;
}

function resolvePublicationHrefLocator(input: ResolveReaderLocatorInput): ResolvedLocator {
  const pagination = requirePagination(input);
  const location = resolveHrefPageLocation(
    input.locator.href,
    pagination.chapterMap,
    input.spine,
    input.manifestHrefs,
    pagination.anchorMap,
    {
      allowChapterStart: false,
      allowMissingAnchorFallback: false,
      chapterAnchorMap: pagination.chapterAnchorMap,
    },
  );
  if (!location) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      input.locator.href.includes('#') ? 'not-found' : 'not-supported',
      `Locator ${input.locator.href} cannot be resolved`,
    );
  }
  const spreadIndex = findSpreadForPage(location.pageIndex, input.record.spreads);
  if (spreadIndex === undefined) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'not-found',
      `No spread contains page ${String(location.pageIndex)}`,
    );
  }
  return toResolvedLocator(input.record, input.locator, {
    pageIndex: location.pageIndex,
    spreadIndex,
  });
}

function requirePagination(input: ResolveReaderLocatorInput): PaginationResult {
  const pagination = input.record.pagination;
  if (pagination) return pagination;
  throw createReaderSessionError(
    input.sessionId,
    input.record.revision.id,
    'internal-error',
    `Revision ${input.record.revision.id} has no pagination metadata`,
  );
}

function findPageForSourceRange(
  pagination: PaginationResult,
  chapterRange: ChapterRange,
  chapterIndex: ChapterTextIndex,
  range: { readonly start: number; readonly end: number },
): number | undefined {
  for (let pageIndex = chapterRange.startPage; pageIndex <= chapterRange.endPage; pageIndex++) {
    const page = pagination.pages[pageIndex];
    if (!page) continue;
    const hitMap = buildHitMap(page);
    if (hitMap.entries.some((entry) => hitEntryOverlapsSourceRange(entry, chapterIndex, range))) {
      return page.index;
    }
  }
  return undefined;
}

function hitEntryOverlapsSourceRange(
  entry: HitEntry,
  chapterIndex: ChapterTextIndex,
  range: { readonly start: number; readonly end: number },
): boolean {
  if (!entry.sourceRef || entry.text.length === 0) return false;
  const start = sourcePointToOffset(chapterIndex, {
    nodePath: entry.sourceRef.nodePath,
    textOffset: entry.sourceTextOffset ?? 0,
  });
  if (start === undefined) return false;
  const end = start + entry.text.length;
  return end > range.start && start < range.end;
}

function isValidSourceRange(start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start;
}

function toResolvedLocator(
  record: ReaderRevisionRecord,
  locator: ReaderLocator,
  location: { readonly pageIndex: number; readonly spreadIndex: number },
): ResolvedLocator {
  return {
    locator,
    revisionId: record.revision.id,
    pageIndex: location.pageIndex,
    spreadIndex: location.spreadIndex,
  };
}

function parseInternalIndex(href: string, prefix: 'page:' | 'spread:'): number | undefined {
  if (!href.startsWith(prefix)) return undefined;
  const rawIndex = href.slice(prefix.length);
  if (!/^(0|[1-9]\d*)$/.test(rawIndex)) return undefined;
  return Number(rawIndex);
}

function isInternalLocatorHref(href: string): boolean {
  return href.startsWith('page:') || href.startsWith('spread:');
}
