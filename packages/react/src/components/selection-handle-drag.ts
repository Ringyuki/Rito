import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type {
  ReaderController,
  SelectionHandleDrag,
  SelectionHandleEdge,
  SelectionHandleState,
} from '@ritojs/kit';

type SelectionHandleCaret = NonNullable<SelectionHandleState['start']>;

export interface ActiveDragVisual {
  readonly edge: SelectionHandleEdge;
  readonly fallbackCaret: SelectionHandleCaret;
}

interface ActiveDragSession {
  readonly pointerId: number;
  readonly drag: SelectionHandleDrag;
  readonly edge: SelectionHandleEdge;
  fallbackCaret: SelectionHandleCaret;
  lastPoint: { readonly clientX: number; readonly clientY: number };
}

interface DragContext {
  readonly controller: ReaderController | null;
  readonly activeRef: RefObject<ActiveDragSession | null>;
  readonly setVisual: (value: ActiveDragVisual | null) => void;
}

interface SelectionHandleDragBindings {
  readonly activeVisual: ActiveDragVisual | null;
  readonly begin: (
    edge: SelectionHandleEdge,
    caret: SelectionHandleCaret,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
  readonly rememberVisibleCaret: (caret: SelectionHandleCaret | null) => void;
  readonly move: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly finish: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly cancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly loseCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

export function useSelectionHandleDrag(
  controller: ReaderController | null,
  enabled: boolean,
): SelectionHandleDragBindings {
  const activeRef = useRef<ActiveDragSession | null>(null);
  const [activeVisual, setVisual] = useState<ActiveDragVisual | null>(null);
  const context: DragContext = { controller, activeRef, setVisual };
  useEffect(() => {
    if (!enabled) cancelActiveDrag(context);
  }, [enabled]);
  useEffect(() => {
    setVisual(null);
    return () => {
      disposeActiveDrag(activeRef);
    };
  }, [controller]);
  return {
    activeVisual,
    begin: (edge, caret, event) => {
      beginDrag(context, edge, caret, event);
    },
    rememberVisibleCaret: (caret) => {
      rememberVisibleCaret(context, caret);
    },
    move: (event) => {
      moveDrag(context, event);
    },
    finish: (event) => {
      finishDrag(context, event);
    },
    cancel: (event) => {
      cancelDrag(context, event);
    },
    loseCapture: (event) => {
      handleLostCapture(context, event);
    },
  };
}

function beginDrag(
  context: DragContext,
  edge: SelectionHandleEdge,
  caret: SelectionHandleCaret,
  event: ReactPointerEvent<HTMLDivElement>,
): void {
  if (!context.controller || context.activeRef.current || !isTouchLikePointer(event.pointerType))
    return;
  stopPointerEvent(event);
  const point = clientPoint(event);
  const drag = context.controller.beginSelectionHandleDrag(edge, point);
  if (!drag) return;
  context.activeRef.current = {
    pointerId: event.pointerId,
    drag,
    edge,
    fallbackCaret: caret,
    lastPoint: point,
  };
  context.setVisual({ edge, fallbackCaret: caret });
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    cancelActiveDrag(context);
  }
}

function rememberVisibleCaret(context: DragContext, caret: SelectionHandleCaret | null): void {
  const active = context.activeRef.current;
  if (!active || !caret || sameCaret(active.fallbackCaret, caret)) return;
  active.fallbackCaret = caret;
  context.setVisual({ edge: active.edge, fallbackCaret: caret });
}

function moveDrag(context: DragContext, event: ReactPointerEvent<HTMLDivElement>): void {
  const active = context.activeRef.current;
  if (!active || active.pointerId !== event.pointerId) return;
  stopPointerEvent(event);
  active.lastPoint = clientPoint(event);
  active.drag.update(active.lastPoint);
}

function finishDrag(context: DragContext, event: ReactPointerEvent<HTMLDivElement>): void {
  const active = takeActiveDrag(context.activeRef, event.pointerId);
  if (!active) return;
  stopPointerEvent(event);
  active.drag.finish(clientPoint(event));
  context.setVisual(null);
  releasePointerCapture(event.currentTarget, event.pointerId);
}

function cancelDrag(context: DragContext, event: ReactPointerEvent<HTMLDivElement>): void {
  const active = takeActiveDrag(context.activeRef, event.pointerId);
  if (!active) return;
  stopPointerEvent(event);
  active.drag.cancel();
  context.setVisual(null);
  releasePointerCapture(event.currentTarget, event.pointerId);
}

function handleLostCapture(context: DragContext, event: ReactPointerEvent<HTMLDivElement>): void {
  const active = takeActiveDrag(context.activeRef, event.pointerId);
  if (!active) return;
  stopPointerEvent(event);
  if (event.buttons === 0) active.drag.finish(active.lastPoint);
  else active.drag.cancel();
  context.setVisual(null);
}

function cancelActiveDrag(context: DragContext): void {
  const active = context.activeRef.current;
  context.activeRef.current = null;
  active?.drag.cancel();
  context.setVisual(null);
}

function disposeActiveDrag(activeRef: RefObject<ActiveDragSession | null>): void {
  const active = activeRef.current;
  activeRef.current = null;
  active?.drag.cancel();
}

function takeActiveDrag(
  activeRef: RefObject<ActiveDragSession | null>,
  pointerId: number,
): ActiveDragSession | null {
  if (activeRef.current?.pointerId !== pointerId) return null;
  const active = activeRef.current;
  activeRef.current = null;
  return active;
}

function clientPoint(event: ReactPointerEvent): {
  readonly clientX: number;
  readonly clientY: number;
} {
  return { clientX: event.clientX, clientY: event.clientY };
}

function stopPointerEvent(event: ReactPointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function isTouchLikePointer(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

function sameCaret(left: SelectionHandleCaret, right: SelectionHandleCaret): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function releasePointerCapture(target: HTMLDivElement, pointerId: number): void {
  try {
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  } catch {
    // The browser may already have released capture before lostpointercapture.
  }
}
