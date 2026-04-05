/**
 * Build an AnnotationTarget from the current selection state.
 * Maps TextRange positions to HitEntry sourceRefs, then uses
 * createAnnotationTarget from rito/annotations.
 */

import type { AnnotationTarget } from 'rito/annotations';
import { createAnnotationTarget } from 'rito/annotations';
import type { HitEntry, HitMap, TextRange } from 'rito/advanced';
import type { Internals } from '../core/internals';

/**
 * Build an AnnotationTarget from a selection range on a specific page.
 * Returns undefined if sourceRefs are not available or the chapter index
 * cannot be resolved.
 */
export function buildAnnotationTargetFromSelection(
  pageIndex: number,
  range: TextRange,
  internals: Internals,
): AnnotationTarget | undefined {
  const hitMap = internals.coordState.hitMaps.get(pageIndex);
  if (!hitMap) return undefined;

  // Find HitEntries for the start and end of the selection
  const startEntry = findHitEntry(hitMap, range.start);
  const endEntry = findHitEntry(hitMap, range.end);
  if (!startEntry || !endEntry) return undefined;
  if (!startEntry.sourceRef || !endEntry.sourceRef) return undefined;

  // Find which chapter this page belongs to
  const href = findChapterHref(pageIndex, internals);
  if (!href) return undefined;

  // Get or build the chapter text index
  const chapterIndex = internals.coordState.chapterIndices.get(href);
  if (!chapterIndex) return undefined;

  // Find the chapter's spine index
  const spineIndex = findSpineIndex(href, internals);

  // Get the selected text
  const selectedText = internals.engines.selection.getText();

  // Compute the actual character offset within the source text node.
  // range.start.charIndex is the offset within the run's text, but the run
  // may start partway through the source text node. sourceTextOffset tells
  // us where the run starts within the source text node.
  const startCharOffset = range.start.charIndex + (startEntry.sourceTextOffset ?? 0);
  const endCharOffset = range.end.charIndex + (endEntry.sourceTextOffset ?? 0);

  return createAnnotationTarget({
    href,
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
