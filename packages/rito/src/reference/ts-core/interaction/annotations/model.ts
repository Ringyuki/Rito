/**
 * Source-anchored annotation record.
 * Only this shape is persisted — pageIndex, TextRange, and Rect are runtime-only.
 */

import type { AnnotationTarget } from '../anchors/model';

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
