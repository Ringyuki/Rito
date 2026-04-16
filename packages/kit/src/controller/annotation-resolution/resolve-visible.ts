/**
 * Resolve source-anchored annotations against the current pagination.
 * Returns resolved annotations without syncing to the old AnnotationEngine.
 */

import type { Reader } from '@rito/core';
import type {
  AnnotationStore,
  ResolvedAnnotation,
  ResolutionContext,
} from '@rito/core/annotations';
import { resolveAnnotations } from '@rito/core/annotations';
import type { CoordinatorState } from '../core/coordinator-state';

/**
 * Resolve all records in the store against the current layout.
 * Returns the resolved annotations for direct use by overlay and hit-test.
 */
export function resolveVisibleAnnotations(
  store: AnnotationStore,
  state: CoordinatorState,
  reader: Reader,
): readonly ResolvedAnnotation[] {
  const records = store.getAll();
  if (records.length === 0) return [];

  const context: ResolutionContext = {
    chapterIndices: state.chapterIndices,
    hitMaps: state.hitMaps,
    chapterPageRanges: reader.chapterMap,
    measurer: reader.measurer,
  };

  return resolveAnnotations(records, context);
}
