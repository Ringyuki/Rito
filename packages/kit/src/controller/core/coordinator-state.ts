import type { SelectionEngine } from 'rito/selection';
import type { SearchEngine } from 'rito/search';
import type { AnnotationStore, ResolvedAnnotation, ChapterTextIndex } from 'rito/annotations';
import type { PositionTracker } from 'rito/position';
import type { HitMap, LinkRegion } from 'rito/advanced';
import type { CoordinateMapper } from '../geometry/coordinate-mapper';

export interface CoordinatorEngines {
  readonly selection: SelectionEngine;
  readonly search: SearchEngine;
  readonly position: PositionTracker | null;
}

export interface CoordinatorState {
  hitMaps: Map<number, HitMap>;
  /** Link regions stored per-page (page-content coords). */
  linksByPage: Map<number, readonly LinkRegion[]>;
  /** Current coordinate mapper (rebuilt on each spread render). */
  mapper: CoordinateMapper | null;
  /** Source-anchored annotation store (new system). */
  annotationStore: AnnotationStore | null;
  /** Chapter text indices keyed by spine idref, for annotation resolution. */
  chapterIndices: Map<string, ChapterTextIndex>;
  /** Resolved annotations for current layout. */
  resolvedAnnotations: readonly ResolvedAnnotation[];
}

export function createCoordinatorState(): CoordinatorState {
  return {
    hitMaps: new Map(),
    linksByPage: new Map(),
    mapper: null,
    annotationStore: null,
    chapterIndices: new Map(),
    resolvedAnnotations: [],
  };
}
