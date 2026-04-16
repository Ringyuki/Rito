import type { AnnotationRecord, AnnotationRecordPatch } from '@rito/core/annotations';
import type { AddAnnotationInput } from '../types';
import type { Internals, AnnotationActionsSlice } from './types';
import { buildAnnotationTargetFromSnapshot } from '../annotation-resolution/target-builder';

export function buildAnnotationActions(internals: Internals): AnnotationActionsSlice {
  return {
    addAnnotation(input: AddAnnotationInput): AnnotationRecord | undefined {
      return addAnnotationImpl(input, internals);
    },
    removeAnnotation(id: string): boolean {
      return removeAnnotationImpl(id, internals);
    },
    updateAnnotation(id: string, patch: AnnotationRecordPatch): boolean {
      return updateAnnotationImpl(id, patch, internals);
    },
    get annotations() {
      const store = internals.coordState.annotationStore;
      return store ? store.getAll() : [];
    },
  };
}

// ── Add / Remove / Update implementations ────────────────────────────

function addAnnotationImpl(
  input: AddAnnotationInput,
  internals: Internals,
): AnnotationRecord | undefined {
  const store = internals.coordState.annotationStore;
  if (!store) return undefined;

  const snapshot = internals.engines.selection.getSnapshot();
  if (!snapshot) return undefined;

  const target = buildAnnotationTargetFromSnapshot(snapshot, internals);
  if (!target) return undefined;

  const record = store.add({
    kind: input.kind,
    target,
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
  void store.persist();
  return record;
}

function removeAnnotationImpl(id: string, internals: Internals): boolean {
  const store = internals.coordState.annotationStore;
  if (!store) return false;
  const ok = store.remove(id);
  if (ok) void store.persist();
  return ok;
}

function updateAnnotationImpl(
  id: string,
  patch: AnnotationRecordPatch,
  internals: Internals,
): boolean {
  const store = internals.coordState.annotationStore;
  if (!store) return false;
  const ok = store.update(id, patch);
  if (ok) void store.persist();
  return ok;
}
