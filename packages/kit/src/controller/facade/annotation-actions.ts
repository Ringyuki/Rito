import type { AnnotationRecord, AnnotationRecordPatch } from '../../interaction/index';
import type { AddAnnotationInput } from '../types';
import type { Internals, AnnotationActionsSlice, Emitter } from './types';
import {
  buildAnnotationTargetFromLocator,
  buildAnnotationTargetFromSnapshot,
} from '../annotation-resolution/target-builder';

export function buildAnnotationActions(
  internals: Internals,
  emitter: Emitter,
): AnnotationActionsSlice {
  return {
    addAnnotation(input: AddAnnotationInput): AnnotationRecord | undefined {
      return addAnnotationImpl(input, internals, emitter);
    },
    removeAnnotation(id: string): boolean {
      return removeAnnotationImpl(id, internals, emitter);
    },
    updateAnnotation(id: string, patch: AnnotationRecordPatch): boolean {
      return updateAnnotationImpl(id, patch, internals, emitter);
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
  emitter: Emitter,
): AnnotationRecord | undefined {
  const store = internals.coordState.annotationStore;
  if (!store) return undefined;

  const sourceLocator = internals.engines.selection.getSourceLocator();
  const snapshot = internals.engines.selection.getSnapshot();
  const target = sourceLocator
    ? buildAnnotationTargetFromLocator(sourceLocator, internals)
    : snapshot
      ? buildAnnotationTargetFromSnapshot(snapshot, internals)
      : undefined;
  if (!target) return undefined;

  const record = store.add({
    kind: input.kind,
    target,
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
  persistAnnotations(store, emitter);
  return record;
}

function removeAnnotationImpl(id: string, internals: Internals, emitter: Emitter): boolean {
  const store = internals.coordState.annotationStore;
  if (!store) return false;
  const ok = store.remove(id);
  if (ok) persistAnnotations(store, emitter);
  return ok;
}

function updateAnnotationImpl(
  id: string,
  patch: AnnotationRecordPatch,
  internals: Internals,
  emitter: Emitter,
): boolean {
  const store = internals.coordState.annotationStore;
  if (!store) return false;
  const ok = store.update(id, patch);
  if (ok) persistAnnotations(store, emitter);
  return ok;
}

function persistAnnotations(
  store: NonNullable<Internals['coordState']['annotationStore']>,
  emitter: Emitter,
): void {
  void store.persist().catch((error: unknown) => {
    try {
      emitter.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        source: 'annotation-storage',
      });
    } catch {
      // Consumer error listeners must not create an unhandled storage rejection.
    }
  });
}
