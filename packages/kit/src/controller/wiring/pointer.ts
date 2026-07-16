import type { SelectionEngine, SelectionGranularity } from '../../interaction/index';

interface ActivePointer {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly downPos: { readonly x: number; readonly y: number };
  readonly granularity: SelectionGranularity;
}

interface PointerBindingContext {
  readonly canvas: HTMLCanvasElement;
  readonly engine: SelectionEngine;
  readonly toContent: (event: PointerEvent) => { x: number; y: number };
  readonly onSingleClick: ((pos: { x: number; y: number }) => void) | undefined;
  active: ActivePointer | null;
}

export function bindPointerEvents(
  canvas: HTMLCanvasElement,
  engine: SelectionEngine,
  toContent: (e: PointerEvent) => { x: number; y: number },
  onSingleClick?: (pos: { x: number; y: number }) => void,
): () => void {
  const context: PointerBindingContext = { canvas, engine, toContent, onSingleClick, active: null };
  const onDown = (event: PointerEvent): void => {
    handlePointerDown(context, event);
  };
  const onMove = (event: PointerEvent): void => {
    handlePointerMove(context, event);
  };
  const onMouseDown = (event: MouseEvent): void => {
    handleMouseDown(context, event);
  };
  const onUp = (event: PointerEvent): void => {
    handlePointerUp(context, event);
  };
  const onCancel = (event: PointerEvent): void => {
    cancelPointer(context, event, true);
  };
  const onLostCapture = (event: PointerEvent): void => {
    handleLostPointerCapture(context, event);
  };

  const remove = (): void => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('lostpointercapture', onLostCapture);
    cancelActivePointer(context);
  };
  try {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('lostpointercapture', onLostCapture);
    return remove;
  } catch (error: unknown) {
    remove();
    throw error;
  }
}

function handlePointerDown(context: PointerBindingContext, event: PointerEvent): void {
  if (event.pointerType === 'touch' || event.button !== 0 || context.active) return;
  const downPos = context.toContent(event);
  context.active = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    downPos,
    granularity: 'character',
  };
  try {
    context.engine.handlePointerDown(downPos);
  } catch (error) {
    context.active = null;
    throw error;
  }
  try {
    context.canvas.setPointerCapture(event.pointerId);
  } catch {
    context.active = null;
    context.engine.clear();
  }
}

function handleMouseDown(context: PointerBindingContext, event: MouseEvent): void {
  const active = context.active;
  const granularity = semanticGranularity(event.detail);
  if (event.button !== 0 || active?.pointerType !== 'mouse' || !granularity) return;
  context.active = { ...active, granularity };
  context.engine.handlePointerDown(active.downPos, granularity);
}

function handlePointerMove(context: PointerBindingContext, event: PointerEvent): void {
  if (event.pointerType === 'touch' || context.active?.pointerId !== event.pointerId) return;
  context.engine.handlePointerMove(context.toContent(event));
}

function handlePointerUp(context: PointerBindingContext, event: PointerEvent): void {
  if (event.pointerType === 'touch') return;
  const completed = takeActivePointer(context, event.pointerId);
  if (!completed) return;
  try {
    const position = context.toContent(event);
    context.engine.handlePointerUp(position);
    if (completed.granularity === 'character' && isSingleClick(completed.downPos, position)) {
      context.onSingleClick?.(position);
    }
  } finally {
    releaseCapture(context.canvas, event.pointerId);
  }
}

function handleLostPointerCapture(context: PointerBindingContext, event: PointerEvent): void {
  if (event.buttons === 0) {
    handlePointerUp(context, event);
    return;
  }
  cancelPointer(context, event, false);
}

function cancelPointer(
  context: PointerBindingContext,
  event: PointerEvent,
  release: boolean,
): void {
  if (event.pointerType === 'touch' || !takeActivePointer(context, event.pointerId)) return;
  try {
    context.engine.clear();
  } finally {
    if (release) releaseCapture(context.canvas, event.pointerId);
  }
}

function cancelActivePointer(context: PointerBindingContext): void {
  const pointerId = context.active?.pointerId;
  if (pointerId === undefined) return;
  context.active = null;
  try {
    context.engine.clear();
  } finally {
    releaseCapture(context.canvas, pointerId);
  }
}

function takeActivePointer(
  context: PointerBindingContext,
  pointerId: number,
): ActivePointer | null {
  if (context.active?.pointerId !== pointerId) return null;
  const current = context.active;
  context.active = null;
  return current;
}

function isSingleClick(
  down: { readonly x: number; readonly y: number },
  up: { readonly x: number; readonly y: number },
): boolean {
  return Math.abs(up.x - down.x) < 3 && Math.abs(up.y - down.y) < 3;
}

function semanticGranularity(detail: number): 'word' | 'paragraph' | undefined {
  if (detail === 2) return 'word';
  if (detail >= 3) return 'paragraph';
  return undefined;
}

function releaseCapture(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  } catch {
    // The browser may already have released capture for pointercancel/lostpointercapture.
  }
}
