import type { AnnotationRecord, AnnotationRecordPatch } from '../../interaction/index';
import type { AddAnnotationInput } from '../types';
import type { Internals, AnnotationActionsSlice, Emitter } from './types';
import { buildAnnotationTargetFromLocator } from '../annotation-resolution/target-builder';

export function buildAnnotationActions(
  internals: Internals,
  emitter: Emitter,
): AnnotationActionsSlice {
  return {
    addAnnotation(input: AddAnnotationInput): Promise<AnnotationRecord | undefined> {
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

/**
 * The selection is read synchronously, so a host may clear it right after
 * calling; only the engine's target build is awaited. A failed build is
 * reported on the `error` event and resolves undefined, never rejects.
 */
async function addAnnotationImpl(
  input: AddAnnotationInput,
  internals: Internals,
  emitter: Emitter,
): Promise<AnnotationRecord | undefined> {
  const store = internals.coordState.annotationStore;
  const sourceLocator = internals.engines.selection.getSourceLocator();
  if (!store || !sourceLocator) return undefined;

  let target;
  try {
    target = await buildAnnotationTargetFromLocator(sourceLocator, internals);
  } catch (error: unknown) {
    emitError(emitter, error, 'annotation-target');
    return undefined;
  }
  if (!target || internals.coordState.annotationStore !== store) return undefined;

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
    emitError(emitter, error, 'annotation-storage');
  });
}

function emitError(emitter: Emitter, error: unknown, source: string): void {
  try {
    emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source,
    });
  } catch {
    // Consumer error listeners must not turn a reported failure into a rejection.
  }
}
