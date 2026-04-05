import type { AnnotationRecord, AnnotationRecordPatch } from 'rito/annotations';
import type { AddAnnotationInput } from '../types';
import type { Internals, AnnotationActionsSlice } from './types';
import { buildAnnotationTargetFromSelection } from '../annotation-resolution/target-builder';

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

  const selectionRange = internals.engines.selection.getSelection();
  if (!selectionRange) return undefined;

  const pageIndex = resolveSelectionPageIndex(internals);
  const target = buildAnnotationTargetFromSelection(pageIndex, selectionRange, internals);
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

// ── Annotation helpers ───────────────────────────────────────────────

/** Determine which page the current selection is on via the CoordinateMapper. */
function resolveSelectionPageIndex(internals: Internals): number {
  const spread = internals.reader.spreads[internals.currentSpread];
  if (!spread) return 0;
  if (!spread.right) return spread.left?.index ?? 0;

  const rects = internals.engines.selection.getRects();
  if (rects.length === 0) return spread.left?.index ?? 0;

  const firstRect = rects[0];
  if (!firstRect) return spread.left?.index ?? 0;

  const { mapper } = internals.coordState;
  if (!mapper) return spread.left?.index ?? 0;

  const resolved = mapper.spreadContentToPage(firstRect.x, firstRect.y);
  return resolved?.pageIndex ?? spread.left?.index ?? 0;
}
