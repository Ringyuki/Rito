/**
 * Build an AnnotationTarget from the current selection state.
 *
 * Responsibility: resolve selection endpoints → normalized chapter offsets.
 * The actual target construction is delegated to createAnnotationTarget()
 * which only accepts canonical chapter-level offsets.
 */

import type { AnnotationTarget } from '@rito/core/annotations';
import { createAnnotationTarget, sourcePointToOffset } from '@rito/core/annotations';
import type { HitEntry, HitMap } from '@rito/core/advanced';
import type { SelectionSnapshot } from '@rito/core/selection';
import type { SourceRef } from '@rito/core/advanced';
import type { Internals } from '../core/internals';

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
  for (const [href, range] of internals.reader.chapterMap) {
    if (pageIndex >= range.startPage && pageIndex <= range.endPage) {
      return href;
    }
  }
  return undefined;
}

/** Find the spine index for a chapter href. */
function findSpineIndex(href: string, internals: Internals): number {
  let idx = 0;
  for (const [h] of internals.reader.chapterMap) {
    if (h === href) return idx;
    idx++;
  }
  return 0;
}
