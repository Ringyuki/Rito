/**
 * Build an AnnotationTarget from the selection's durable source range.
 *
 * The exact source range is kept as the authoritative selector; the fallback
 * selectors are derived from normalized chapter offsets by createAnnotationTarget().
 */

import {
  createAnnotationTarget,
  sourcePointToOffset,
  type AnnotationTarget,
  type ChapterTextIndex,
} from '../../interaction/index';
import type { ReaderLocator } from '@ritojs/core';
import type { Internals } from '../core/internals';
import { findChapterSpineIndex } from './chapter-identity';

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
    chapterSpineIndex: findChapterSpineIndex(internals.reader, locator.href),
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

function findChapterIndex(href: string, internals: Internals): ChapterTextIndex | undefined {
  const direct = internals.coordState.chapterIndices.get(href);
  if (direct) return direct;
  const canonicalHref = internals.reader.manifestHrefMap.get(href);
  if (canonicalHref) {
    return internals.coordState.chapterIndices.get(canonicalHref);
  }
  return undefined;
}
