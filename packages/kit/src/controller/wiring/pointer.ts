import type { SelectionEngine, SelectionGranularity } from '../../interaction/index';
import type {
  PrimarySelectionDragNavigation,
  PrimarySelectionDragSession,
  PrimarySelectionInputIntent,
} from './selection-drag';
import { installPointerListeners } from './pointer-listeners';

interface ActivePointer {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly downEvent: PointerEvent;
  downPos: { readonly x: number; readonly y: number };
  readonly granularity: SelectionGranularity;
  readonly selectionInput: PrimarySelectionInputIntent | null;
  selectionDrag: PrimarySelectionDragSession | null;
}

interface PointerBindingContext {
  readonly canvas: HTMLCanvasElement;
  readonly engine: SelectionEngine;
  readonly toContent: (event: PointerEvent) => { x: number; y: number };
  readonly onSingleClick: ((pos: { x: number; y: number }) => void) | undefined;
  readonly selectionNavigation: PrimarySelectionDragNavigation | undefined;
  active: ActivePointer | null;
}

export function bindPointerEvents(
  canvas: HTMLCanvasElement,
  engine: SelectionEngine,
  toContent: (e: PointerEvent) => { x: number; y: number },
  onSingleClick?: (pos: { x: number; y: number }) => void,
  selectionNavigation?: PrimarySelectionDragNavigation,
): () => void {
  const context: PointerBindingContext = {
    canvas,
    engine,
    toContent,
    onSingleClick,
    selectionNavigation,
    active: null,
  };
  return installPointerListeners(
    canvas,
    {
      down: (event) => {
        handlePointerDown(context, event);
      },
      mouseDown: (event) => {
        handleMouseDown(context, event);
      },
      move: (event) => {
        handlePointerMove(context, event);
      },
      up: (event) => {
        handlePointerUp(context, event);
      },
      cancel: (event) => {
        cancelPointer(context, event, true);
      },
      lostCapture: (event) => {
        handleLostPointerCapture(context, event);
      },
    },
    () => {
      cancelActivePointer(context);
    },
  );
}

function handlePointerDown(context: PointerBindingContext, event: PointerEvent): void {
  if (event.pointerType === 'touch' || event.button !== 0 || context.active) return;
  const selectionInput = context.selectionNavigation?.claim() ?? null;
  if (context.selectionNavigation && !selectionInput) return;
  const downPos = context.toContent(event);
  const active: ActivePointer = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    downEvent: event,
    downPos,
    granularity: 'character',
    selectionInput,
    selectionDrag: null,
  };
  context.active = active;
  try {
    active.selectionDrag = beginSelectionDrag(context, active.selectionInput, () => {
      active.downPos = context.toContent(active.downEvent);
      context.engine.handlePointerDown(active.downPos);
    });
    if (!ownsSelectionDrag(active)) {
      context.active = null;
      if (active.selectionDrag?.cancel()) context.engine.clear();
      return;
    }
  } catch (error) {
    context.active = null;
    throw error;
  }
  try {
    context.canvas.setPointerCapture(event.pointerId);
  } catch {
    context.active = null;
    const ownsSelection = cancelSelectionDrag(active);
    if (ownsSelection) context.engine.clear();
  }
}

function handleMouseDown(context: PointerBindingContext, event: MouseEvent): void {
  const active = context.active;
  const granularity = semanticGranularity(event.detail);
  if (event.button !== 0 || active?.pointerType !== 'mouse' || !granularity) return;
  if (!ownsSelectionDrag(active)) {
    abandonPointer(context, active);
    return;
  }
  const previousSelectionDrag = active.selectionDrag;
  previousSelectionDrag?.cancel();
  const selectionDrag = beginSelectionDrag(context, active.selectionInput, () => {
    active.downPos = context.toContent(active.downEvent);
    context.engine.handlePointerDown(active.downPos, granularity);
  });
  if (context.active !== active) {
    clearExactSelection(context, selectionDrag, previousSelectionDrag);
    return;
  }
  if (selectionDrag && !selectionDrag.owns()) {
    clearExactSelection(context, selectionDrag, previousSelectionDrag);
    context.active = null;
    releaseCapture(context.canvas, active.pointerId);
    return;
  }
  context.active = { ...active, granularity, selectionDrag };
}

function handlePointerMove(context: PointerBindingContext, event: PointerEvent): void {
  const active = context.active;
  if (event.pointerType === 'touch' || active?.pointerId !== event.pointerId) return;
  if (!ownsSelectionDrag(active)) {
    if (active.selectionDrag?.wasSuperseded() !== false) abandonPointer(context, active);
    return;
  }
  context.engine.handlePointerMove(context.toContent(event));
  active.selectionDrag?.update(toClientPoint(event));
}

function handlePointerUp(context: PointerBindingContext, event: PointerEvent): void {
  if (event.pointerType === 'touch') return;
  const completed = takeActivePointer(context, event.pointerId);
  if (!completed) return;
  const navigated = completed.selectionDrag?.didNavigate() === true;
  const ownsSelection = finishSelectionDrag(context, completed);
  try {
    const position =
      completed.selectionDrag?.resolveFinalInput?.(toClientPoint(event)) ??
      context.toContent(event);
    const settledWithoutReplacement =
      !ownsSelection &&
      completed.selectionDrag?.wasSuperseded() === false &&
      context.engine.getState() === 'idle';
    if (!ownsSelection && !settledWithoutReplacement) return;
    if (ownsSelection) context.engine.handlePointerUp(position);
    if (
      !navigated &&
      completed.granularity === 'character' &&
      isSingleClick(completed.downPos, position) &&
      completed.selectionDrag?.wasSuperseded() !== true &&
      (completed.selectionInput?.owns() ?? true)
    ) {
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
  if (event.pointerType === 'touch') return;
  const active = takeActivePointer(context, event.pointerId);
  if (!active) return;
  const ownsSelection = cancelSelectionDrag(active);
  try {
    if (ownsSelection) context.engine.clear();
  } finally {
    if (release) releaseCapture(context.canvas, event.pointerId);
  }
}

function cancelActivePointer(context: PointerBindingContext): void {
  const pointerId = context.active?.pointerId;
  if (pointerId === undefined) return;
  const active = context.active;
  context.active = null;
  const ownsSelection = active ? cancelSelectionDrag(active) : false;
  try {
    if (ownsSelection) context.engine.clear();
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

function beginSelectionDrag(
  context: PointerBindingContext,
  input: PrimarySelectionInputIntent | null,
  startSelection: () => void,
): PrimarySelectionDragSession | null {
  if (context.selectionNavigation && input) {
    return context.selectionNavigation.begin(input, startSelection);
  }
  startSelection();
  return null;
}
function clearExactSelection(
  context: PointerBindingContext,
  current: PrimarySelectionDragSession | null,
  previous: PrimarySelectionDragSession | null,
): void {
  if (current?.cancel() || previous?.cancel()) context.engine.clear();
}

function toClientPoint(event: PointerEvent): {
  readonly clientX: number;
  readonly clientY: number;
} {
  return { clientX: event.clientX, clientY: event.clientY };
}

function ownsSelectionDrag(active: ActivePointer): boolean {
  return active.selectionDrag?.owns() ?? active.selectionInput?.owns() ?? true;
}

function abandonPointer(context: PointerBindingContext, active: ActivePointer): void {
  if (context.active !== active) return;
  context.active = null;
  if (active.selectionDrag?.cancel()) context.engine.clear();
  releaseCapture(context.canvas, active.pointerId);
}

function finishSelectionDrag(context: PointerBindingContext, active: ActivePointer): boolean {
  const session = active.selectionDrag;
  if (!session) return active.selectionInput?.owns() ?? true;
  if (!session.owns()) {
    if (session.cancel()) context.engine.clear();
    return false;
  }
  const ownsFinalization = session.finish();
  if (!ownsFinalization && session.cancel()) context.engine.clear();
  return ownsFinalization;
}

function cancelSelectionDrag(active: ActivePointer): boolean {
  const session = active.selectionDrag;
  if (!session) return active.selectionInput?.owns() ?? true;
  return session.cancel();
}
