/**
 * Convert between SourcePoint (nodePath + textOffset) and normalized chapter offsets.
 */

import type { SourcePoint } from './model';
import type { ChapterTextIndex } from './chapter-text-index';

/** Convert a SourcePoint to a normalized offset in the chapter text. */
export function sourcePointToOffset(
  index: ChapterTextIndex,
  point: SourcePoint,
): number | undefined {
  for (const span of index.spans) {
    if (
      pathEquals(span.nodePath, point.nodePath) &&
      point.textOffset >= span.sourceStart &&
      point.textOffset <= span.sourceEnd
    ) {
      return span.normalizedStart + (point.textOffset - span.sourceStart);
    }
  }
  return undefined;
}

/** Convert a normalized offset to the nearest SourcePoint. */
export function offsetToSourcePoint(
  index: ChapterTextIndex,
  offset: number,
): SourcePoint | undefined {
  for (const span of index.spans) {
    if (offset >= span.normalizedStart && offset <= span.normalizedEnd) {
      return {
        nodePath: span.nodePath,
        textOffset: offset - span.normalizedStart + span.sourceStart,
      };
    }
  }
  return undefined;
}

function pathEquals(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
