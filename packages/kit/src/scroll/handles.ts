import type { ReaderTextCaret } from '@ritojs/core';
import type {
  SelectionClientPoint,
  SelectionHandleDrag,
  SelectionHandleEdge,
  SelectionHandleState,
} from '../controller/types';
import { edgeSpeed } from './selection-input';
import type { ScrollController } from './types';
import { shownRects, type ScrollView } from './view';

/**
 * The ends of what is selected where the view shows them, in CSS pixels
 * from its top-left corner, and the end the reader is moving; null when
 * nothing is selected.
 */
export function selectionHandles(view: ScrollView): SelectionHandleState | null {
  const snapshot = view.selection?.snapshot;
  if (!snapshot) return null;
  const at = (caret: ReaderTextCaret) =>
    shownRects(view, [{ pageIndex: caret.pageIndex, ...caret.geometry }])[0] ?? null;
  return {
    start: at(snapshot.range.start),
    end: at(snapshot.range.end),
    focusEdge: snapshot.focusDirection === 'forward' ? 'end' : 'start',
  };
}

/**
 * Drags end `edge` of what is selected from client point `origin`: each
 * client point moves it to the page point under it, the strip scrolling on
 * while the point is held near either end of the view. Null when nothing
 * is selected to drag.
 */
export function beginSelectionHandleDrag(
  view: ScrollView,
  controller: ScrollController,
  edge: SelectionHandleEdge,
  origin: SelectionClientPoint,
): SelectionHandleDrag | null {
  const drag = view.selection?.handleDrag(edge);
  if (!drag) return null;
  const canvas = view.surface.canvas;
  let at = local(canvas, origin);
  let frame: number | null = null;
  const pointOf = (point: { x: number; y: number }) => controller.pointAt(point.x, point.y);
  const follow = (): void => {
    frame = null;
    const speed = edgeSpeed(canvas, controller, at);
    if (speed === 0) return;
    controller.scrollBy(speed);
    const point = pointOf(at);
    if (point) drag.update(point);
    frame = requestAnimationFrame(follow);
  };
  const stop = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  return {
    update(point) {
      at = local(canvas, point);
      const under = pointOf(at);
      if (under) drag.update(under);
      if (frame === null && edgeSpeed(canvas, controller, at) !== 0) {
        frame = requestAnimationFrame(follow);
      }
    },
    finish(point) {
      stop();
      const under = pointOf(local(canvas, point));
      if (under) drag.finish(under);
      else drag.cancel();
    },
    cancel() {
      stop();
      drag.cancel();
    },
  };
}

function local(canvas: HTMLCanvasElement, point: SelectionClientPoint): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: point.clientX - rect.left, y: point.clientY - rect.top };
}
