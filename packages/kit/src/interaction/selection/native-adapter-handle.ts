import type { ReaderTextPoint } from '@ritojs/core';
import type { PointerInput } from './engine';
import type { SelectionHandleDrag } from './handle-types';
import type {
  NativeSelectionEngine,
  NativeSelectionHandleDrag,
  NativeSelectionHandleEdge,
} from './native-types';

/** Start a handle session only if synchronous listeners leave that exact session current. */
export function beginNativeSelectionHandleDrag(
  native: NativeSelectionEngine,
  edge: NativeSelectionHandleEdge,
  projectPoint: (input: PointerInput) => ReaderTextPoint | undefined,
): SelectionHandleDrag | null {
  const expectedGeneration = native.getInteractionGeneration() + 1;
  const nativeDrag = native.beginHandleDrag(edge);
  if (
    !nativeDrag ||
    native.getInteractionGeneration() !== expectedGeneration ||
    !native.hasActiveHandleDrag()
  ) {
    nativeDrag?.cancel();
    return null;
  }
  return adaptNativeSelectionHandleDrag(nativeDrag, projectPoint);
}

/** Adapt one native page-local drag session to spread-content coordinates. */
export function adaptNativeSelectionHandleDrag(
  nativeDrag: NativeSelectionHandleDrag,
  projectPoint: (input: PointerInput) => ReaderTextPoint | undefined,
): SelectionHandleDrag {
  let active = true;
  let lastValidPoint: ReaderTextPoint | undefined;
  return {
    update(input) {
      if (!active) return;
      const point = projectPoint(input);
      if (!point) return;
      lastValidPoint = point;
      nativeDrag.update(point);
    },
    finish(input) {
      if (!active) return;
      active = false;
      const point = projectPoint(input) ?? lastValidPoint;
      lastValidPoint = undefined;
      if (point) nativeDrag.finish(point);
      else nativeDrag.cancel();
    },
    cancel() {
      if (!active) return;
      active = false;
      lastValidPoint = undefined;
      nativeDrag.cancel();
    },
  };
}
