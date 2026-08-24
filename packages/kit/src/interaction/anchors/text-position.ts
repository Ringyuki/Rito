/**
 * TextPositionSelector creation and resolution.
 * Simply stores/validates character offsets in normalized chapter text.
 */

import type { TextPositionSelector } from './model';
import type { ChapterTextIndex } from './chapter-text-index';

export function createTextPositionSelector(start: number, end: number): TextPositionSelector {
  return { type: 'TextPositionSelector', start, end };
}

export function resolveTextPositionSelector(
  index: ChapterTextIndex,
  selector: TextPositionSelector,
): { start: number; end: number } | undefined {
  if (selector.start < 0 || selector.end > index.normalizedText.length) return undefined;
  if (selector.start >= selector.end) return undefined;
  return { start: selector.start, end: selector.end };
}
