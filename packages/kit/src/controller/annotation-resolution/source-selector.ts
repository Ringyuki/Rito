import type { ReaderExactSourceRangeRequest, Reader } from '@ritojs/core';
import type {
  AnnotationRecord,
  ChapterTextIndex,
  ResolutionStatus,
  SourcePoint,
} from '../../interaction/index';
import { offsetToSourcePoint, sourcePointToOffset } from '../../interaction/index';
import { resolveProgressionSelector } from '../../interaction/anchors/progression';
import { resolveTextPositionSelector } from '../../interaction/anchors/text-position';
import { resolveTextQuoteSelector } from '../../interaction/anchors/quote-match';
import type { CoordinatorState } from '../core/coordinator-state';

export interface ResolvedAnnotationSource {
  readonly status: Exclude<ResolutionStatus, 'orphaned'>;
  readonly request: ReaderExactSourceRangeRequest;
  readonly key: string;
}

export function resolveAnnotationSource(
  record: AnnotationRecord,
  state: Pick<CoordinatorState, 'chapterIndices'>,
  reader: Pick<Reader, 'manifestHrefMap'>,
): ResolvedAnnotationSource | undefined {
  const chapter = resolveChapter(record.target.href, state.chapterIndices, reader.manifestHrefMap);
  if (!chapter) return undefined;
  const selectors = record.target.selectors;
  const exact = validSourceRange(chapter, selectors.sourceRange.start, selectors.sourceRange.end);
  if (exact) return resolvedSource('exact', chapter.href, exact.start, exact.end);

  const quote = resolveTextQuoteSelector(chapter, selectors.textQuote);
  const quoteRange = quote && offsetRange(chapter, quote.start, quote.end);
  if (quoteRange) {
    return resolvedSource('quote-fallback', chapter.href, quoteRange.start, quoteRange.end);
  }

  const position = resolveTextPositionSelector(chapter, selectors.textPosition);
  const positionRange = position && offsetRange(chapter, position.start, position.end);
  if (positionRange) {
    return resolvedSource(
      'position-fallback',
      chapter.href,
      positionRange.start,
      positionRange.end,
    );
  }

  const progression = resolveProgressionSelector(chapter, selectors.progression);
  const progressionRange = offsetRange(
    chapter,
    progression,
    nextTextBoundary(chapter.normalizedText, progression),
  );
  return progressionRange
    ? resolvedSource(
        'progression-fallback',
        chapter.href,
        progressionRange.start,
        progressionRange.end,
      )
    : undefined;
}

function resolveChapter(
  href: string,
  indices: ReadonlyMap<string, ChapterTextIndex>,
  aliases: ReadonlyMap<string, string>,
): ChapterTextIndex | undefined {
  return indices.get(href) ?? indices.get(aliases.get(href) ?? '');
}

function validSourceRange(
  chapter: ChapterTextIndex,
  start: SourcePoint,
  end: SourcePoint,
): { readonly start: SourcePoint; readonly end: SourcePoint } | undefined {
  const startOffset = sourcePointToOffset(chapter, start);
  const endOffset = sourcePointToOffset(chapter, end);
  if (startOffset === undefined || endOffset === undefined || startOffset >= endOffset) {
    return undefined;
  }
  return { start, end };
}

function offsetRange(
  chapter: ChapterTextIndex,
  startOffset: number,
  endOffset: number,
): { readonly start: SourcePoint; readonly end: SourcePoint } | undefined {
  if (startOffset < 0 || startOffset >= endOffset || endOffset > chapter.normalizedText.length) {
    return undefined;
  }
  const start = offsetToSourcePoint(chapter, startOffset);
  const end = offsetToSourcePoint(chapter, endOffset);
  return start && end ? { start, end } : undefined;
}

function nextTextBoundary(text: string, offset: number): number {
  if (offset < 0 || offset >= text.length) return offset;
  const first = text.charCodeAt(offset);
  return first >= 0xd800 && first <= 0xdbff && offset + 1 < text.length ? offset + 2 : offset + 1;
}

function resolvedSource(
  status: Exclude<ResolutionStatus, 'orphaned'>,
  href: string,
  start: SourcePoint,
  end: SourcePoint,
): ResolvedAnnotationSource {
  const request: ReaderExactSourceRangeRequest = {
    href,
    sourceRange: {
      start: copyPoint(start),
      end: copyPoint(end),
    },
  };
  return { status, request, key: sourceRangeKey(request) };
}

export function sourceRangeKey(request: ReaderExactSourceRangeRequest): string {
  return JSON.stringify([
    request.href,
    request.sourceRange.start.nodePath,
    request.sourceRange.start.textOffset,
    request.sourceRange.end.nodePath,
    request.sourceRange.end.textOffset,
  ]);
}

function copyPoint(point: SourcePoint): SourcePoint {
  return { nodePath: [...point.nodePath], textOffset: point.textOffset };
}
