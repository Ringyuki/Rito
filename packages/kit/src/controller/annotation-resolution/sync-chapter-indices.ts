/**
 * Sync chapter text indices from the Reader's source-based indices.
 * These are built from the parsed XHTML tree during pagination,
 * not from layout output — so they are document-stable.
 */

import type { Reader } from 'rito';
import type { ChapterTextIndex } from 'rito/annotations';
import type { CoordinatorState } from '../core/coordinator-state';

export function syncChapterIndices(state: CoordinatorState, reader: Reader): void {
  const sourceIndices = reader.getChapterTextIndices();
  const target = new Map<string, ChapterTextIndex>();
  for (const [key, value] of sourceIndices) target.set(key, value);
  state.chapterIndices = target;
}
