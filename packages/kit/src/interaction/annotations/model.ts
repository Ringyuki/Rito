/**
 * Source-anchored annotation records and their resolved runtime projections.
 * Only the record shape is persisted; page indexes and rectangles are
 * re-resolved against each committed layout revision.
 */

import type { ReaderAnnotationTarget } from '@ritojs/core';
import type { Rect } from '../layout-types';

/** The engine-built persisted anchor; every host stores the same form. */
export type AnnotationTarget = ReaderAnnotationTarget;

/** A persistent annotation record anchored to source content. */
export interface AnnotationRecord {
  readonly id: string;
  readonly kind: 'highlight' | 'underline' | 'note';
  readonly target: AnnotationTarget;
  readonly color?: string;
  readonly note?: string;
  readonly createdAt: number;
  readonly modifiedAt?: number;
}

/** Input for creating a new annotation (id and timestamps generated automatically). */
export interface AnnotationDraft {
  readonly kind: 'highlight' | 'underline' | 'note';
  readonly target: AnnotationTarget;
  readonly color?: string;
  readonly note?: string;
}

/** Patchable fields for updating an existing annotation. */
export interface AnnotationRecordPatch {
  readonly color?: string;
  readonly note?: string;
}

/** Which level of the engine's cascade located the record in the current source text. */
export type ResolutionStatus = 'exact' | 'quote' | 'position' | 'progression' | 'orphaned';

/** The record's rectangles on one page, in page-content coordinates from the committed revision. */
export interface ResolvedAnnotationSegment {
  readonly pageIndex: number;
  readonly rects: readonly Rect[];
}

/** A record projected onto the current layout. */
export interface ResolvedAnnotation {
  readonly id: string;
  readonly record: AnnotationRecord;
  readonly status: ResolutionStatus;
  readonly segments: readonly ResolvedAnnotationSegment[];
}
