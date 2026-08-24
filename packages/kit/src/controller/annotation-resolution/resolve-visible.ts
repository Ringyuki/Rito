/**
 * Resolve source-anchored annotations against the current pagination.
 * Returns resolved annotations without syncing to the old AnnotationEngine.
 */

import type { Reader } from '@ritojs/core';
import type {
  AnnotationStore,
  ResolvedAnnotation,
  ResolutionContext,
} from '../../interaction/index';
import { resolveAnnotations } from '../../interaction/index';
import type { CoordinatorState } from '../core/coordinator-state';
import { buildChapterPageRanges } from './chapter-identity';

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
    chapterPageRanges: buildChapterPageRanges(reader),
    chapterHrefMap: reader.manifestHrefMap,
    measurer: reader.measurer,
  };

  return resolveAnnotations(records, context);
}
