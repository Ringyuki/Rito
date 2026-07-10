/**
 * AnnotationResolver — resolves source-anchored annotations against current pagination.
 * This is the bridge between persistent AnnotationRecords and runtime geometry.
 */

import type { Rect } from '../../layout/core/types';
import type { HitMap, TextRange } from '../core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { ChapterTextIndex } from '../anchors/chapter-text-index';
import type { AnnotationRecord } from './model';
import { resolveTextQuoteSelector } from '../anchors/quote-match';
import { resolveTextPositionSelector } from '../anchors/text-position';
import { resolveProgressionSelector } from '../anchors/progression';
import { offsetToSourcePoint } from '../anchors/source-point';
import { resolveSourceRangeToSegments } from './source-to-page';

export type ResolutionStatus =
  | 'exact'
  | 'quote-fallback'
  | 'position-fallback'
  | 'progression-fallback'
  | 'orphaned';

/** A resolved annotation segment on a specific page. */
export interface ResolvedAnnotationSegment {
  readonly pageIndex: number;
  readonly range: TextRange;
  readonly rects: readonly Rect[];
}

/** A fully resolved annotation in the current layout. */
export interface ResolvedAnnotation {
  readonly id: string;
  readonly record: AnnotationRecord;
  readonly status: ResolutionStatus;
  readonly segments: readonly ResolvedAnnotationSegment[];
}

/** Context needed to resolve annotations against current pagination. */
export interface ResolutionContext {
  /** Chapter text indices keyed by href. */
  readonly chapterIndices: ReadonlyMap<string, ChapterTextIndex>;
  /** Hit maps keyed by page index. */
  readonly hitMaps: ReadonlyMap<number, HitMap>;
  /** Page index range per chapter href. */
  readonly chapterPageRanges: ReadonlyMap<string, { startPage: number; endPage: number }>;
  readonly measurer: TextMeasurer;
}

/**
 * Resolve annotation records against the current pagination.
 * Uses the selector cascade: SourceRange -> TextQuote -> TextPosition -> Progression.
 */
export function resolveAnnotations(
  records: readonly AnnotationRecord[],
  context: ResolutionContext,
): readonly ResolvedAnnotation[] {
  return records.map((record) => resolveOne(record, context));
}

function resolveOne(record: AnnotationRecord, context: ResolutionContext): ResolvedAnnotation {
  const { href, selectors } = record.target;
  const chapterIndex = context.chapterIndices.get(href);
  if (!chapterIndex) return orphaned(record);

  // 1. Try SourceRangeSelector (authoritative)
  const sourceSegments = resolveSourceRangeToSegments(selectors.sourceRange, chapterIndex, context);
  if (sourceSegments.length > 0) {
    return { id: record.id, record, status: 'exact', segments: sourceSegments };
  }

  // 2. Try TextQuoteSelector (fallback)
  const quoteRange = resolveTextQuoteSelector(chapterIndex, selectors.textQuote);
  if (quoteRange) {
    const segments = offsetRangeToSegments(quoteRange.start, quoteRange.end, chapterIndex, context);
    if (segments.length > 0) {
      return { id: record.id, record, status: 'quote-fallback', segments };
    }
  }

  // 3. Try TextPositionSelector
  const posRange = resolveTextPositionSelector(chapterIndex, selectors.textPosition);
  if (posRange) {
    const segments = offsetRangeToSegments(posRange.start, posRange.end, chapterIndex, context);
    if (segments.length > 0) {
      return { id: record.id, record, status: 'position-fallback', segments };
    }
  }

  // 4. Try ProgressionSelector (coarse)
  const approxOffset = resolveProgressionSelector(chapterIndex, selectors.progression);
  if (approxOffset >= 0 && approxOffset < chapterIndex.normalizedText.length) {
    // Use a small range around the progression point
    const end = Math.min(chapterIndex.normalizedText.length, approxOffset + 1);
    const segments = offsetRangeToSegments(approxOffset, end, chapterIndex, context);
    if (segments.length > 0) {
      return { id: record.id, record, status: 'progression-fallback', segments };
    }
  }

  return orphaned(record);
}

/**
 * Convert a normalized character range back to page segments.
 * Maps offsets -> SourcePoints -> page HitEntries.
 */
function offsetRangeToSegments(
  startOffset: number,
  endOffset: number,
  chapterIndex: ChapterTextIndex,
  context: ResolutionContext,
): ResolvedAnnotationSegment[] {
  const startPoint = offsetToSourcePoint(chapterIndex, startOffset);
  const endPoint = offsetToSourcePoint(chapterIndex, endOffset);
  if (!startPoint || !endPoint) return [];

  // Construct a synthetic SourceRangeSelector for resolution
  return resolveSourceRangeToSegments(
    { type: 'SourceRangeSelector', start: startPoint, end: endPoint },
    chapterIndex,
    context,
  );
}

function orphaned(record: AnnotationRecord): ResolvedAnnotation {
  return { id: record.id, record, status: 'orphaned', segments: [] };
}
