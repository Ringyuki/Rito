import type { Annotation } from 'rito/annotations';
import type { createAnnotationEngine } from 'rito/annotations';
import type { ReaderController } from '../types';
import type { Internals, AnnotationActionsSlice } from './types';

export function buildAnnotationActions(internals: Internals): AnnotationActionsSlice {
  return {
    addAnnotation(
      input: Omit<Parameters<ReaderController['addAnnotation']>[0], never>,
    ): Annotation | undefined {
      const pageIndex = resolveSelectionPageIndex(internals);
      removeOverlapping(internals.engines.annotation, pageIndex, input.range);
      const ann = internals.engines.annotation.add({ ...input, pageIndex });
      void internals.engines.annotation.persist();
      return ann;
    },
    removeAnnotation(id: string): boolean {
      const ok = internals.engines.annotation.remove(id);
      if (ok) void internals.engines.annotation.persist();
      return ok;
    },
    updateAnnotation(
      id: string,
      patch: Parameters<ReaderController['updateAnnotation']>[1],
    ): boolean {
      const ok = internals.engines.annotation.update(id, patch);
      if (ok) void internals.engines.annotation.persist();
      return ok;
    },
    get annotations() {
      return internals.engines.annotation.getAll();
    },
  };
}

// ── Annotation helpers (merged from annotation-helpers.ts) ──────────

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

/** Remove existing annotations that overlap with the given range on the same page. */
function removeOverlapping(
  engine: ReturnType<typeof createAnnotationEngine>,
  pageIndex: number,
  range: Parameters<ReaderController['addAnnotation']>[0]['range'],
): void {
  for (const ann of engine.getForPage(pageIndex)) {
    if (rangesOverlap(ann.range, range)) engine.remove(ann.id);
  }
}

interface Pos {
  blockIndex: number;
  lineIndex: number;
  charIndex: number;
}

function rangesOverlap(a: { start: Pos; end: Pos }, b: { start: Pos; end: Pos }): boolean {
  return posLe(a.start, b.end) && posLe(b.start, a.end);
}

function posLe(a: Pos, b: Pos): boolean {
  if (a.blockIndex !== b.blockIndex) return a.blockIndex < b.blockIndex;
  if (a.lineIndex !== b.lineIndex) return a.lineIndex < b.lineIndex;
  return a.charIndex <= b.charIndex;
}
