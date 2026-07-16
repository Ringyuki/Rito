import type { ReaderTextPoint } from '@ritojs/core';
import type { PointerInput } from './engine';
import type { SelectionHandleDrag } from './handle-types';
import type { NativeSelectionHandleDrag } from './native-types';

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
