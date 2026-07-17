import type { ReaderInteractionTarget } from '@ritojs/core';
import type { SelectionEngine } from '../../interaction/index';
import type { SearchEngine } from '../../interaction/index';
import type {
  AnnotationStore,
  ResolvedAnnotation,
  ChapterTextIndex,
} from '../../interaction/index';
import type {
  HitMap,
  LinkRegion,
  PositionIntent,
  PositionTracker,
  ReadingPosition,
} from '../../interaction/index';
import type { CoordinateMapper } from '../geometry/coordinate-mapper';
import type { SelectionGestureLease } from '../../interaction/selection/selection-interaction-owner';
import {
  createNativeAnnotationGeometryState,
  type NativeAnnotationGeometryState,
} from '../annotation-resolution/native-geometry';
import {
  createNativeSearchGeometryState,
  type NativeSearchGeometryState,
} from '../search-resolution/native-geometry';

export interface CoordinatorEngines {
  readonly selection: SelectionEngine;
  readonly search: SearchEngine;
  readonly position: PositionTracker | null;
}

export type PositionUpdateMode =
  | { readonly kind: 'capture' }
  | {
      readonly kind: 'preserve';
      readonly position: ReadingPosition;
      readonly intent?: PositionIntent;
    }
  | {
      readonly kind: 'skip';
      readonly spreadIndex: number;
      readonly intent?: PositionIntent;
    };

export interface SelectionProjectionTransfer {
  readonly targetSpreadIndex: number;
  readonly gesture: SelectionGestureLease;
}

export interface CoordinatorState {
  /** Invalidates an outer spread coordination pass when callbacks re-enter with a newer spread. */
  spreadCoordinationGeneration: number;
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
  /** Chapter text indices keyed by durable resource href, for annotation resolution. */
  chapterIndices: Map<string, ChapterTextIndex>;
  /** Reader-owned source Map used to avoid rebuilding the href projection on every turn. */
  chapterIndexSource: ReadonlyMap<string, ChapterTextIndex> | null;
  /** Resolved annotations for current layout. */
  resolvedAnnotations: readonly ResolvedAnnotation[];
  /** Revision-owned exact source-range projections and in-flight reads. */
  nativeAnnotationGeometry: NativeAnnotationGeometryState;
  /** Revision/results-owned native search projections for visited visible spreads. */
  nativeSearchGeometry: NativeSearchGeometryState;
  /** Active image blob URL (revoked automatically on next imageClick or dispose). */
  activeImageBlobUrl: string | null;
  /** Latest-wins owner shared by asynchronous content-click dispatch. */
  contentInteractionGeneration: number;
  /** One-shot position behavior for the next active spread notification. */
  positionUpdateMode: PositionUpdateMode;
  /** Synchronous same-revision projection transaction for one exact active selection gesture. */
  selectionProjectionTransfer: SelectionProjectionTransfer | null;
}

export function createCoordinatorState(): CoordinatorState {
  return {
    spreadCoordinationGeneration: 0,
    hitMaps: new Map(),
    linksByPage: new Map(),
    nativeTargetsByPage: new Map(),
    nativeTargetLoadGeneration: 0,
    nativeInteractionsAlive: true,
    mapper: null,
    annotationStore: null,
    chapterIndices: new Map(),
    chapterIndexSource: null,
    resolvedAnnotations: [],
    nativeAnnotationGeometry: createNativeAnnotationGeometryState(),
    nativeSearchGeometry: createNativeSearchGeometryState(),
    activeImageBlobUrl: null,
    contentInteractionGeneration: 0,
    positionUpdateMode: { kind: 'capture' },
    selectionProjectionTransfer: null,
  };
}
