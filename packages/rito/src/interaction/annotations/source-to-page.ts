/**
 * Resolve a SourceRangeSelector to page-level annotation segments.
 * Walks HitEntries to find runs matching the source range,
 * then produces TextRange + Rect for each page.
 */

import type { Rect } from '../../layout/core/types';
import type { HitEntry, HitMap, TextRange } from '../core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { SourceRangeSelector } from '../anchors/model';
import type { ChapterTextIndex } from '../anchors/chapter-text-index';
import { sourcePointToOffset } from '../anchors/source-point';
import { getSelectionRects } from '../selection/range';
import type { ResolutionContext, ResolvedAnnotationSegment } from './resolver';

/**
 * Resolve a SourceRangeSelector into segments across pages.
 * Matches HitEntry.sourceRef.nodePath against the selector's source points.
 */
export function resolveSourceRangeToSegments(
  selector: SourceRangeSelector,
  chapterIndex: ChapterTextIndex,
  context: ResolutionContext,
): ResolvedAnnotationSegment[] {
  // Convert source points to normalized offsets for comparison
  const startOffset = sourcePointToOffset(chapterIndex, selector.start);
  const endOffset = sourcePointToOffset(chapterIndex, selector.end);
  if (startOffset === undefined || endOffset === undefined) return [];

  const segments: ResolvedAnnotationSegment[] = [];
  const pageRange = context.chapterPageRanges.get(chapterIndex.href);
  if (!pageRange) return [];

  // Scan pages in this chapter
  for (let pageIdx = pageRange.startPage; pageIdx <= pageRange.endPage; pageIdx++) {
    const hitMap = context.hitMaps.get(pageIdx);
    if (!hitMap) continue;

    const pageSegment = resolveOnPage(
      hitMap,
      startOffset,
      endOffset,
      chapterIndex,
      context.measurer,
    );
    if (pageSegment) {
      segments.push({ pageIndex: pageIdx, ...pageSegment });
    }
  }

  return segments;
}

/**
 * Try to resolve the annotation range on a single page.
 * Finds the start and end HitEntry by matching sourceRef offsets.
 */
function resolveOnPage(
  hitMap: HitMap,
  targetStart: number,
  targetEnd: number,
  chapterIndex: ChapterTextIndex,
  measurer: TextMeasurer,
): { range: TextRange; rects: readonly Rect[] } | undefined {
  const endpoints = findOverlappingEntries(hitMap, targetStart, targetEnd, chapterIndex);
  if (!endpoints) return undefined;

  const range = buildTextRange(endpoints.start, endpoints.end);
  const rects = getSelectionRects(hitMap, range, measurer);
  return rects.length > 0 ? { range, rects } : undefined;
}

interface EntryMatch {
  entry: HitEntry;
  index: number;
  charOffset: number;
}

function findOverlappingEntries(
  hitMap: HitMap,
  targetStart: number,
  targetEnd: number,
  chapterIndex: ChapterTextIndex,
): { start: EntryMatch; end: EntryMatch } | undefined {
  let startMatch: EntryMatch | undefined;
  let endMatch: EntryMatch | undefined;

  for (let i = 0; i < hitMap.entries.length; i++) {
    const entry = hitMap.entries[i];
    if (!entry?.sourceRef) continue;

    const srcOffset = entry.sourceTextOffset ?? 0;
    const entryStart = sourcePointToOffset(chapterIndex, {
      nodePath: entry.sourceRef.nodePath,
      textOffset: srcOffset,
    });
    if (entryStart === undefined) continue;

    const entryEnd = entryStart + entry.text.length;
    if (entryEnd <= targetStart || entryStart >= targetEnd) continue;

    if (!startMatch) {
      startMatch = { entry, index: i, charOffset: Math.max(0, targetStart - entryStart) };
    }
    endMatch = { entry, index: i, charOffset: Math.min(entry.text.length, targetEnd - entryStart) };
  }

  return startMatch && endMatch ? { start: startMatch, end: endMatch } : undefined;
}

function buildTextRange(start: EntryMatch, end: EntryMatch): TextRange {
  return {
    start: {
      blockIndex: start.entry.blockIndex,
      lineIndex: start.entry.lineIndex,
      runIndex: start.entry.runIndex,
      charIndex: start.charOffset,
    },
    end: {
      blockIndex: end.entry.blockIndex,
      lineIndex: end.entry.lineIndex,
      runIndex: end.entry.runIndex,
      charIndex: end.charOffset,
    },
  };
}
