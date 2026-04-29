import { sourcePointToOffset } from '../../interaction/anchors/source-point';
import { buildHitMap } from '../../interaction/core/hit-map';
import type { HitEntry, HitMap, TextRange } from '../../interaction/core/types';
import { getSelectionRects } from '../../interaction/selection';
import type { ChapterTextIndex } from '../../interaction/anchors/chapter-text-index';
import type { Rect } from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { SpineItem } from '../../parser/epub/types';
import type { ChapterRange, PaginationResult } from '../types';
import { findSpreadForPage, resolveHrefPageLocation, type HrefPageLocation } from '../navigation';
import { createReaderSessionError } from './errors';
import type { ReaderRevisionRecord } from './revision';
import type { ReaderLocator, ReaderSessionId, ResolvedLocatorGeometry } from './types';

export interface ResolveReaderLocatorGeometryInput {
  readonly sessionId: ReaderSessionId;
  readonly record: ReaderRevisionRecord;
  readonly locator: ReaderLocator;
  readonly spine: readonly SpineItem[];
  readonly manifestHrefs: ReadonlyMap<string, string>;
  readonly measurer: TextMeasurer;
}

interface SourceRange {
  readonly start: number;
  readonly end: number;
}

export function resolveReaderLocatorGeometry(
  input: ResolveReaderLocatorGeometryInput,
): ResolvedLocatorGeometry {
  const range = requireSourceRange(input);
  const pagination = requirePagination(input);
  const location = requireSourceRangeLocation(input, pagination);
  const chapterIndex = pagination.chapterTextIndices.get(location.spineIdref);
  const chapterRange = pagination.chapterMap.get(location.spineIdref);
  if (!chapterIndex || !chapterRange || range.end > chapterIndex.normalizedText.length) {
    sourceRangeUnavailable(input);
  }

  const segments = resolveSourceRangeSegments(input, pagination, chapterRange, chapterIndex, range);
  if (segments.length === 0) sourceRangeUnavailable(input);
  return {
    locator: input.locator,
    revisionId: input.record.revision.id,
    segments,
  };
}

function resolveSourceRangeSegments(
  input: ResolveReaderLocatorGeometryInput,
  pagination: PaginationResult,
  chapterRange: ChapterRange,
  chapterIndex: ChapterTextIndex,
  range: SourceRange,
): ResolvedLocatorGeometry['segments'] {
  const segments: ResolvedLocatorGeometry['segments'][number][] = [];
  for (let pageIndex = chapterRange.startPage; pageIndex <= chapterRange.endPage; pageIndex++) {
    const page = pagination.pages[pageIndex];
    if (!page) continue;
    const hitMap = buildHitMap(page);
    const textRange = resolvePageTextRange(hitMap, chapterIndex, range);
    if (!textRange) continue;
    const spreadIndex = findSpreadForPage(page.index, input.record.spreads);
    if (spreadIndex === undefined) continue;
    const rects = getSelectionRects(hitMap, textRange, input.measurer).map((rect) =>
      toSpreadRect(input, spreadIndex, page.index, rect),
    );
    if (rects.length > 0) {
      segments.push({ pageIndex: page.index, spreadIndex, rects });
    }
  }
  return segments;
}

function requireSourceRange(input: ResolveReaderLocatorGeometryInput): SourceRange {
  const range = input.locator.sourceRange;
  if (!range) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'not-supported',
      'Only source-range locator geometry is supported',
    );
  }
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start
  ) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'bad-request',
      'Source-range locator is invalid',
    );
  }
  return range;
}

function requireSourceRangeLocation(
  input: ResolveReaderLocatorGeometryInput,
  pagination: PaginationResult,
): HrefPageLocation {
  const location = resolveHrefPageLocation(
    input.locator.href,
    pagination.chapterMap,
    input.spine,
    input.manifestHrefs,
    pagination.anchorMap,
    { allowMissingAnchorFallback: false },
  );
  if (location) return location;
  throw createReaderSessionError(
    input.sessionId,
    input.record.revision.id,
    input.locator.href.includes('#') ? 'not-found' : 'not-supported',
    `Locator ${input.locator.href} cannot be resolved`,
  );
}

function resolvePageTextRange(
  hitMap: HitMap,
  chapterIndex: ChapterTextIndex,
  range: SourceRange,
): TextRange | undefined {
  const endpoints = findOverlappingEntries(hitMap, chapterIndex, range);
  if (!endpoints) return undefined;
  return {
    start: textPosition(endpoints.start),
    end: textPosition(endpoints.end),
  };
}

interface EntryMatch {
  readonly entry: HitEntry;
  readonly charOffset: number;
}

function findOverlappingEntries(
  hitMap: HitMap,
  chapterIndex: ChapterTextIndex,
  range: SourceRange,
): { readonly start: EntryMatch; readonly end: EntryMatch } | undefined {
  let start: EntryMatch | undefined;
  let end: EntryMatch | undefined;
  for (const entry of hitMap.entries) {
    if (!entry.sourceRef || entry.text.length === 0) continue;
    const entryStart = sourcePointToOffset(chapterIndex, {
      nodePath: entry.sourceRef.nodePath,
      textOffset: entry.sourceTextOffset ?? 0,
    });
    if (entryStart === undefined) continue;
    const entryEnd = entryStart + entry.text.length;
    if (entryEnd <= range.start || entryStart >= range.end) continue;
    start ??= { entry, charOffset: Math.max(0, range.start - entryStart) };
    end = { entry, charOffset: Math.min(entry.text.length, range.end - entryStart) };
  }
  return start && end ? { start, end } : undefined;
}

function textPosition(match: EntryMatch): TextRange['start'] {
  return {
    blockIndex: match.entry.blockIndex,
    lineIndex: match.entry.lineIndex,
    runIndex: match.entry.runIndex,
    charIndex: match.charOffset,
  };
}

function toSpreadRect(
  input: ResolveReaderLocatorGeometryInput,
  spreadIndex: number,
  pageIndex: number,
  rect: Rect,
): Rect {
  return {
    x: pageOffsetX(input, spreadIndex, pageIndex) + input.record.layout.marginLeft + rect.x,
    y: input.record.layout.marginTop + rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function pageOffsetX(
  input: ResolveReaderLocatorGeometryInput,
  spreadIndex: number,
  pageIndex: number,
): number {
  const spread = input.record.spreads[spreadIndex];
  if (spread?.right?.index === pageIndex) {
    return input.record.layout.pageWidth + input.record.layout.spreadGap;
  }
  return 0;
}

function requirePagination(input: ResolveReaderLocatorGeometryInput): PaginationResult {
  const pagination = input.record.pagination;
  if (pagination) return pagination;
  throw createReaderSessionError(
    input.sessionId,
    input.record.revision.id,
    'internal-error',
    `Revision ${input.record.revision.id} has no pagination metadata`,
  );
}

function sourceRangeUnavailable(input: ResolveReaderLocatorGeometryInput): never {
  throw createReaderSessionError(
    input.sessionId,
    input.record.revision.id,
    'not-found',
    `Source range for ${input.locator.href} is not available`,
  );
}
