import type { SelectionClientPoint, SelectionHandleDrag, SelectionHandleEdge } from '../types';
import { clientToSpreadContent } from '../core/wiring-deps';
import type { Internals, SelectionAccessorsSlice } from './types';

export function buildSelectionAccessors(
  internals: Internals,
  canvas: HTMLCanvasElement,
): SelectionAccessorsSlice {
  return {
    clearSelection(): void {
      internals.engines.selection.clear();
    },
    get hasSelection() {
      return internals.engines.selection.hasSelection();
    },
    get selectionText() {
      return internals.engines.selection.getText();
    },
    get selectionRange() {
      return internals.engines.selection.getSelection();
    },
    get selectionSourceLocator() {
      return internals.engines.selection.getSourceLocator();
    },
    beginSelectionHandleDrag(edge, origin) {
      return beginHandleDrag(internals, canvas, edge, origin);
    },
  };
}

function beginHandleDrag(
  internals: Internals,
  canvas: HTMLCanvasElement,
  edge: SelectionHandleEdge,
  origin: SelectionClientPoint,
): SelectionHandleDrag | null {
  if (!isFiniteClientPoint(origin)) return null;
  const mapper = internals.coordState.mapper;
  const caret = internals.engines.selection.getHandleCarets()?.[edge];
  if (!mapper || !caret) return null;
  const drag = internals.engines.selection.beginHandleDrag(edge);
  if (!drag) return null;
  const grabOffset = computeGrabOffset(internals, canvas, caret, origin);
  let active = true;
  let moved = false;
  return {
    update(point) {
      if (!active || !isFiniteClientPoint(point) || sameClientPoint(point, origin)) return;
      moved = true;
      drag.update(toContent(point, grabOffset));
    },
    finish(point) {
      if (!active) return;
      active = false;
      if (!isFiniteClientPoint(point) || (!moved && sameClientPoint(point, origin))) {
        drag.cancel();
        return;
      }
      drag.finish(toContent(point, grabOffset));
    },
    cancel() {
      if (!active) return;
      active = false;
      drag.cancel();
    },
  };

  function toContent(point: SelectionClientPoint, offset: GrabOffset) {
    return clientToSpreadContent(
      point.clientX - offset.x,
      point.clientY - offset.y,
      canvas.getBoundingClientRect(),
      internals.coordState,
    );
  }
}

interface GrabOffset {
  readonly x: number;
  readonly y: number;
}

function computeGrabOffset(
  internals: Internals,
  canvas: HTMLCanvasElement,
  caret: { readonly x: number; readonly y: number; readonly height: number },
  origin: SelectionClientPoint,
): GrabOffset {
  const mapper = internals.coordState.mapper;
  if (!mapper) return { x: 0, y: 0 };
  const viewportCaret = mapper.spreadContentRectToViewport({ ...caret, width: 0 });
  const canvasRect = canvas.getBoundingClientRect();
  const scale = internals.renderScale;
  return {
    x: origin.clientX - (canvasRect.left + viewportCaret.x * scale),
    y: origin.clientY - (canvasRect.top + (viewportCaret.y + viewportCaret.height / 2) * scale),
  };
}

function isFiniteClientPoint(point: SelectionClientPoint): boolean {
  return Number.isFinite(point.clientX) && Number.isFinite(point.clientY);
}

function sameClientPoint(left: SelectionClientPoint, right: SelectionClientPoint): boolean {
  return left.clientX === right.clientX && left.clientY === right.clientY;
}
