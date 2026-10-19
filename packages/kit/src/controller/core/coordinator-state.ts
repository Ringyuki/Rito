import type { ReaderInteractionTarget, Spread } from '@ritojs/core';
import type { SelectionEngine } from '../../interaction/index';
import type { SearchEngine } from '../../interaction/index';
import type { AnnotationStore, ResolvedAnnotation } from '../../interaction/index';
import type { PositionIntent, PositionTracker, ReadingPosition } from '../../interaction/index';
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
  /** Reader-owned semantic targets (links, footnotes, images) for the currently installed visible spread. */
  nativeTargetsByPage: Map<number, readonly ReaderInteractionTarget[]>;
  /** Invalidates async native-target reads across spread, revision, preview, and disposal changes. */
  nativeTargetLoadGeneration: number;
  /** False after controller disposal; retained event callbacks must not re-enter navigation. */
  nativeInteractionsAlive: boolean;
  /**
   * While a window is being resized every frame shows a spread of a new
   * layout: its targets are cleared, and read once the size has settled
   * (`reload`, for the spread shown then) instead of on every frame.
   */
  nativeTargetHold: { held: boolean; reload: (() => void) | null };
  /** Current coordinate mapper (rebuilt on each spread render). */
  mapper: CoordinateMapper | null;
  /** Source-anchored annotation store. */
  annotationStore: AnnotationStore | null;
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
  /** The position hosts were last told of by `positionChange`. */
  publishedPosition: ReadingPosition | null;
  /** The layout hosts were last told of by `layoutChange`. */
  publishedLayout: { readonly spreads: readonly Spread[]; readonly totalSpreads: number } | null;
  /**
   * Search results name pages of the layout they were found in: a layout
   * that replaces it leaves them stale until `refresh` has searched again.
   */
  searchResults: { stale: boolean; refresh: (() => void) | null };
}

export function createCoordinatorState(): CoordinatorState {
  return {
    spreadCoordinationGeneration: 0,
    nativeTargetsByPage: new Map(),
    nativeTargetLoadGeneration: 0,
    nativeInteractionsAlive: true,
    nativeTargetHold: { held: false, reload: null },
    mapper: null,
    annotationStore: null,
    resolvedAnnotations: [],
    nativeAnnotationGeometry: createNativeAnnotationGeometryState(),
    nativeSearchGeometry: createNativeSearchGeometryState(),
    activeImageBlobUrl: null,
    contentInteractionGeneration: 0,
    positionUpdateMode: { kind: 'capture' },
    publishedPosition: null,
    publishedLayout: null,
    selectionProjectionTransfer: null,
    searchResults: { stale: false, refresh: null },
  };
}
