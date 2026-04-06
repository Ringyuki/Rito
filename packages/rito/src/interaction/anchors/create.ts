/**
 * Create an AnnotationTarget from normalized chapter-level offsets.
 *
 * This is the canonical way to build an annotation target. All selectors
 * (SourceRange, TextQuote, TextPosition, Progression) are derived from
 * the same pair of normalized offsets, guaranteeing internal consistency.
 */

import type { AnnotationTarget, LocatorTextContext, SourceRangeSelector } from './model';
import type { ChapterTextIndex } from './chapter-text-index';
import { offsetToSourcePoint } from './source-point';
import { createTextQuoteSelector } from './quote-match';
import { createTextPositionSelector } from './text-position';
import { createProgressionSelector } from './progression';

export interface CreateTargetFromOffsetsInput {
  /** Chapter href this annotation belongs to. */
  readonly href: string;
  /** Pre-built chapter text index. */
  readonly chapterIndex: ChapterTextIndex;
  /** Chapter position in spine order (0-based). */
  readonly chapterSpineIndex: number;
  /** Start offset in the chapter's normalized text. */
  readonly startOffset: number;
  /** End offset in the chapter's normalized text. */
  readonly endOffset: number;
}

/**
 * Build an AnnotationTarget from normalized chapter offsets.
 * Internally normalizes start/end (min/max), so callers don't need to guarantee order.
 * Returns undefined if the range is empty or offsets can't be mapped to source points.
 */
export function createAnnotationTarget(
  input: CreateTargetFromOffsetsInput,
): AnnotationTarget | undefined {
  // Normalize — always ensure start <= end
  const lo = Math.min(input.startOffset, input.endOffset);
  const hi = Math.max(input.startOffset, input.endOffset);
  if (lo === hi) return undefined; // empty range

  const { chapterIndex, href, chapterSpineIndex } = input;
  const { normalizedText } = chapterIndex;

  // Derive SourcePoints from offsets
  const startPoint = offsetToSourcePoint(chapterIndex, lo);
  const endPoint = offsetToSourcePoint(chapterIndex, hi);
  if (!startPoint || !endPoint) return undefined;

  const sourceRange: SourceRangeSelector = {
    type: 'SourceRangeSelector',
    start: startPoint,
    end: endPoint,
  };

  const textQuote = createTextQuoteSelector(chapterIndex, lo, hi);
  const textPosition = createTextPositionSelector(lo, hi);
  const progression = createProgressionSelector(chapterSpineIndex, lo, normalizedText.length);

  // Derive text context from the canonical source
  const highlight = normalizedText.slice(lo, hi);
  const text: LocatorTextContext = { highlight };
  if (lo > 0) {
    (text as { before: string }).before = normalizedText.slice(Math.max(0, lo - 32), lo);
  }
  if (hi < normalizedText.length) {
    (text as { after: string }).after = normalizedText.slice(
      hi,
      Math.min(normalizedText.length, hi + 32),
    );
  }

  return {
    href,
    selectors: { sourceRange, textQuote, textPosition, progression },
    text,
  };
}
