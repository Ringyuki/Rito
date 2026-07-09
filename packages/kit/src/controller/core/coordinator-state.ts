import type { SelectionEngine } from '@ritojs/core/selection';
import type { SearchEngine } from '@ritojs/core/search';
import type {
  AnnotationStore,
  ResolvedAnnotation,
  ChapterTextIndex,
} from '@ritojs/core/annotations';
import type { PositionTracker, ReadingPosition } from '@ritojs/core/position';
import type { HitMap, LinkRegion } from '@ritojs/core/integration';
import type { CoordinateMapper } from '../geometry/coordinate-mapper';

export interface CoordinatorEngines {
  readonly selection: SelectionEngine;
  readonly search: SearchEngine;
  readonly position: PositionTracker | null;
}

export type PositionUpdateMode =
  | { readonly kind: 'capture' }
  | { readonly kind: 'preserve'; readonly position: ReadingPosition }
  | { readonly kind: 'skip' };

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
  /** Active image blob URL (revoked automatically on next imageClick or dispose). */
  activeImageBlobUrl: string | null;
  /** One-shot position behavior for the next active spread notification. */
  positionUpdateMode: PositionUpdateMode;
}

export function createCoordinatorState(): CoordinatorState {
  return {
    hitMaps: new Map(),
    linksByPage: new Map(),
    mapper: null,
    annotationStore: null,
    chapterIndices: new Map(),
    resolvedAnnotations: [],
    activeImageBlobUrl: null,
    positionUpdateMode: { kind: 'capture' },
  };
}
