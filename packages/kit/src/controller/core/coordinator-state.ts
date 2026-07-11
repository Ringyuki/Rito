import type { ReaderInteractionTarget } from '@ritojs/core';
import type { SelectionEngine } from '../../interaction/index';
import type { SearchEngine } from '../../interaction/index';
import type {
  AnnotationStore,
  ResolvedAnnotation,
  ChapterTextIndex,
} from '../../interaction/index';
import type { HitMap, LinkRegion, PositionTracker, ReadingPosition } from '../../interaction/index';
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
  /** Rust-owned semantic targets for the currently installed visible spread. */
  nativeTargetsByPage: Map<number, readonly ReaderInteractionTarget[]>;
  /** Invalidates async native-target reads across spread, revision, preview, and disposal changes. */
  nativeTargetLoadGeneration: number;
  /** False after controller disposal; retained event callbacks must not re-enter navigation. */
  nativeInteractionsAlive: boolean;
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
    nativeTargetsByPage: new Map(),
    nativeTargetLoadGeneration: 0,
    nativeInteractionsAlive: true,
    mapper: null,
    annotationStore: null,
    chapterIndices: new Map(),
    resolvedAnnotations: [],
    activeImageBlobUrl: null,
    positionUpdateMode: { kind: 'capture' },
  };
}
