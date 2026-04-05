/**
 * Create an AnnotationTarget from a selection in the current layout.
 */

import type { HitEntry } from '../core/types';
import type { AnnotationTarget } from './model';
import type { ChapterTextIndex } from './chapter-text-index';
import { sourcePointToOffset } from './source-point';
import { createTextQuoteSelector } from './quote-match';
import { createTextPositionSelector } from './text-position';
import { createProgressionSelector } from './progression';
import type { LocatorTextContext, SourcePoint, SourceRangeSelector } from './model';

export interface CreateTargetInput {
  /** Chapter href this selection belongs to. */
  readonly href: string;
  /** HitEntry at the selection start. */
  readonly startEntry: HitEntry;
  /** Character offset within startEntry. */
  readonly startCharOffset: number;
  /** HitEntry at the selection end. */
  readonly endEntry: HitEntry;
  /** Character offset within endEntry. */
  readonly endCharOffset: number;
  /** Pre-built chapter text index. */
  readonly chapterIndex: ChapterTextIndex;
  /** Chapter position in spine order (0-based). */
  readonly chapterSpineIndex: number;
  /** The selected text. */
  readonly selectedText: string;
}

export function createAnnotationTarget(input: CreateTargetInput): AnnotationTarget | undefined {
  const startSourceRef = input.startEntry.sourceRef;
  const endSourceRef = input.endEntry.sourceRef;
  if (!startSourceRef || !endSourceRef) return undefined;

  const startPoint: SourcePoint = {
    nodePath: startSourceRef.nodePath,
    textOffset: input.startCharOffset,
  };
  const endPoint: SourcePoint = {
    nodePath: endSourceRef.nodePath,
    textOffset: input.endCharOffset,
  };

  const sourceRange: SourceRangeSelector = {
    type: 'SourceRangeSelector',
    start: startPoint,
    end: endPoint,
  };

  // Resolve normalized offsets for other selectors
  const startOffset = sourcePointToOffset(input.chapterIndex, startPoint);
  const endOffset = sourcePointToOffset(input.chapterIndex, endPoint);
  if (startOffset === undefined || endOffset === undefined) return undefined;

  const textQuote = createTextQuoteSelector(input.chapterIndex, startOffset, endOffset);
  const textPosition = createTextPositionSelector(startOffset, endOffset);
  const progression = createProgressionSelector(
    input.chapterSpineIndex,
    startOffset,
    input.chapterIndex.normalizedText.length,
  );

  // Extract text context
  const normalizedText = input.chapterIndex.normalizedText;
  const text: LocatorTextContext = { highlight: input.selectedText };
  if (startOffset > 0) {
    (text as { before: string }).before = normalizedText.slice(
      Math.max(0, startOffset - 32),
      startOffset,
    );
  }
  if (endOffset < normalizedText.length) {
    (text as { after: string }).after = normalizedText.slice(
      endOffset,
      Math.min(normalizedText.length, endOffset + 32),
    );
  }

  return {
    href: input.href,
    selectors: { sourceRange, textQuote, textPosition, progression },
    text,
  };
}
