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
  let startEntry: { entry: HitEntry; index: number; charOffset: number } | undefined;
  let endEntry: { entry: HitEntry; index: number; charOffset: number } | undefined;

  for (let i = 0; i < hitMap.entries.length; i++) {
    const entry = hitMap.entries[i];
    if (!entry?.sourceRef) continue;

    // Find the normalized offset range this entry covers using sourceTextOffset
    const srcOffset = entry.sourceTextOffset ?? 0;
    const entryStartOffset = sourcePointToOffset(chapterIndex, {
      nodePath: entry.sourceRef.nodePath,
      textOffset: srcOffset,
    });
    if (entryStartOffset === undefined) continue;

    const entryEndOffset = entryStartOffset + entry.text.length;

    // Check if this entry overlaps with our target range
    if (entryEndOffset <= targetStart || entryStartOffset >= targetEnd) continue;

    // First overlapping entry becomes the start
    if (!startEntry) {
      const charOffset = Math.max(0, targetStart - entryStartOffset);
      startEntry = { entry, index: i, charOffset };
    }

    // Last overlapping entry becomes the end
    const endCharOffset = Math.min(entry.text.length, targetEnd - entryStartOffset);
    endEntry = { entry, index: i, charOffset: endCharOffset };
  }

  if (!startEntry || !endEntry) return undefined;

  const range: TextRange = {
    start: {
      blockIndex: startEntry.entry.blockIndex,
      lineIndex: startEntry.entry.lineIndex,
      runIndex: startEntry.entry.runIndex,
      charIndex: startEntry.charOffset,
    },
    end: {
      blockIndex: endEntry.entry.blockIndex,
      lineIndex: endEntry.entry.lineIndex,
      runIndex: endEntry.entry.runIndex,
      charIndex: endEntry.charOffset,
    },
  };

  const rects = getSelectionRects(hitMap, range, measurer);
  return rects.length > 0 ? { range, rects } : undefined;
}
