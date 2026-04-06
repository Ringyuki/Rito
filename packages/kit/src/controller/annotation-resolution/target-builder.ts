/**
 * Build an AnnotationTarget from the current selection state.
 * Maps page-aware endpoints to HitEntry sourceRefs, then uses
 * createAnnotationTarget from rito/annotations.
 */

import type { AnnotationTarget } from 'rito/annotations';
import { createAnnotationTarget } from 'rito/annotations';
import type { HitEntry, HitMap } from 'rito/advanced';
import type { SelectionSnapshot } from 'rito/selection';
import type { Internals } from '../core/internals';

/**
 * Build an AnnotationTarget from a SelectionSnapshot.
 * Each endpoint is resolved against its own page's HitMap,
 * supporting both same-page and cross-page (same-chapter) selections.
 * Returns undefined if the selection spans multiple chapters or sourceRefs are unavailable.
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
  if (!startEntry.sourceRef || !endEntry.sourceRef) return undefined;

  // Both endpoints must be in the same chapter
  const startHref = findChapterHref(start.pageIndex, internals);
  const endHref = findChapterHref(end.pageIndex, internals);
  if (!startHref || !endHref || startHref !== endHref) return undefined;

  const chapterIndex = internals.coordState.chapterIndices.get(startHref);
  if (!chapterIndex) return undefined;

  const spineIndex = findSpineIndex(startHref, internals);
  const selectedText = internals.engines.selection.getText();

  const startCharOffset = start.position.charIndex + (startEntry.sourceTextOffset ?? 0);
  const endCharOffset = end.position.charIndex + (endEntry.sourceTextOffset ?? 0);

  return createAnnotationTarget({
    href: startHref,
    startEntry,
    startCharOffset,
    endEntry,
    endCharOffset,
    chapterIndex,
    chapterSpineIndex: spineIndex,
    selectedText,
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
