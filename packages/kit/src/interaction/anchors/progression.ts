/**
 * ProgressionSelector creation and resolution.
 * Provides coarse chapter-level position for last-resort fallback.
 */

import type { ProgressionSelector } from './model';
import type { ChapterTextIndex } from './chapter-text-index';

export function createProgressionSelector(
  chapterIndex: number,
  normalizedOffset: number,
  totalChapterLength: number,
): ProgressionSelector {
  const chapterProgress = totalChapterLength > 0 ? normalizedOffset / totalChapterLength : 0;
  return {
    type: 'ProgressionSelector',
    chapter: chapterIndex,
    chapterProgress: Math.min(1, Math.max(0, chapterProgress)),
  };
}

export function resolveProgressionSelector(
  index: ChapterTextIndex,
  selector: ProgressionSelector,
): number {
  return Math.round(selector.chapterProgress * index.normalizedText.length);
}
