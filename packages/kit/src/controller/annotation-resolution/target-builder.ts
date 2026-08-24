/**
 * Build an AnnotationTarget from the current selection state.
 *
 * Responsibility: resolve selection endpoints → normalized chapter offsets.
 * The actual target construction is delegated to createAnnotationTarget()
 * which only accepts canonical chapter-level offsets.
 */

import {
  createAnnotationTarget,
  sourcePointToOffset,
  type AnnotationTarget,
  type ChapterTextIndex,
  type HitEntry,
  type HitMap,
  type SelectionSnapshot,
  type SourceRef,
} from '../../interaction/index';
import type { ReaderLocator } from '@ritojs/core';
import type { Internals } from '../core/internals';
import { chapterHrefForIdref, findChapterSpineIndex } from './chapter-identity';

/**
 * Build an AnnotationTarget from a SelectionSnapshot.
 * Each endpoint is resolved against its own page's HitMap, then converted
 * to normalized chapter offsets for the canonical createAnnotationTarget() API.
 */
export function buildAnnotationTargetFromSnapshot(
  snapshot: SelectionSnapshot,
  internals: Internals,
): AnnotationTarget | undefined {
  const { start, end } = snapshot;

  // Resolve HitEntries from each endpoint's own page HitMap
  const startHitMap = internals.coordState.hitMaps.get(start.pageIndex);
  const endHitMap = internals.coordState.hitMaps.get(end.pageIndex);
  if (!startHitMap || !endHitMap) return undefined;

  const startEntry = findHitEntry(startHitMap, start.position);
  const endEntry = findHitEntry(endHitMap, end.position);
  if (!startEntry || !endEntry) return undefined;

  const startSourceRef = startEntry.sourceRef;
  const endSourceRef = endEntry.sourceRef;
  if (!startSourceRef || !endSourceRef) return undefined;

  // Both endpoints must be in the same chapter
  const startHref = findChapterHref(start.pageIndex, internals);
  const endHref = findChapterHref(end.pageIndex, internals);
  if (!startHref || !endHref || startHref !== endHref) return undefined;

  const chapterIndex = internals.coordState.chapterIndices.get(startHref);
  if (!chapterIndex) return undefined;

  // Convert HitEntry endpoints → normalized chapter offsets
  const startOffset = resolveEntryOffset(
    startSourceRef,
    start.position.charIndex,
    startEntry,
    chapterIndex,
  );
  const endOffset = resolveEntryOffset(
    endSourceRef,
    end.position.charIndex,
    endEntry,
    chapterIndex,
  );
  if (startOffset === undefined || endOffset === undefined) return undefined;

  return createAnnotationTarget({
    href: startHref,
    chapterIndex,
    chapterSpineIndex: findSpineIndex(startHref, internals),
    startOffset,
    endOffset,
  });
}

/** Build a persistent annotation target directly from the native source range. */
export function buildAnnotationTargetFromLocator(
  locator: ReaderLocator,
  internals: Internals,
): AnnotationTarget | undefined {
  const sourceRange = locator.sourceRange;
  if (!sourceRange) return undefined;
  const chapterIndex = findChapterIndex(locator.href, internals);
  if (!chapterIndex) return undefined;
  const startOffset = sourcePointToOffset(chapterIndex, sourceRange.start);
  const endOffset = sourcePointToOffset(chapterIndex, sourceRange.end);
  if (startOffset === undefined || endOffset === undefined) return undefined;
  const target = createAnnotationTarget({
    href: locator.href,
    chapterIndex,
    chapterSpineIndex: findSpineIndex(locator.href, internals),
    startOffset,
    endOffset,
  });
  if (!target) return undefined;
  return {
    ...target,
    selectors: {
      ...target.selectors,
      sourceRange: {
        type: 'SourceRangeSelector',
        start: {
          nodePath: [...sourceRange.start.nodePath],
          textOffset: sourceRange.start.textOffset,
        },
        end: {
          nodePath: [...sourceRange.end.nodePath],
          textOffset: sourceRange.end.textOffset,
        },
      },
    },
  };
}

/** Resolve a HitEntry + charIndex to a normalized chapter offset. */
function resolveEntryOffset(
  sourceRef: SourceRef,
  charIndex: number,
  entry: HitEntry,
  chapterIndex: Parameters<typeof sourcePointToOffset>[0],
): number | undefined {
  return sourcePointToOffset(chapterIndex, {
    nodePath: sourceRef.nodePath,
    textOffset: charIndex + (entry.sourceTextOffset ?? 0),
  });
}

/** Find the HitEntry matching a TextPosition by block/line/run indices. */
function findHitEntry(
  hitMap: HitMap,
  pos: { blockIndex: number; lineIndex: number; runIndex: number },
): HitEntry | undefined {
  return hitMap.entries.find(
    (e) =>
      e.blockIndex === pos.blockIndex &&
      e.lineIndex === pos.lineIndex &&
      e.runIndex === pos.runIndex,
  );
}

/** Find which chapter href a page belongs to using the reader's chapterMap. */
function findChapterHref(pageIndex: number, internals: Internals): string | undefined {
  for (const [idref, range] of internals.reader.chapterMap) {
    if (pageIndex >= range.startPage && pageIndex <= range.endPage) {
      return chapterHrefForIdref(internals.reader, idref);
    }
  }
  return undefined;
}

/** Find the spine index for a chapter href. */
function findSpineIndex(href: string, internals: Internals): number {
  return findChapterSpineIndex(internals.reader, href);
}

function findChapterIndex(href: string, internals: Internals): ChapterTextIndex | undefined {
  const direct = internals.coordState.chapterIndices.get(href);
  if (direct) return direct;
  const canonicalHref = internals.reader.manifestHrefMap.get(href);
  if (canonicalHref) {
    return internals.coordState.chapterIndices.get(canonicalHref);
  }
  return undefined;
}
