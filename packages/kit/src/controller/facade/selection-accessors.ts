import type { SelectionClientPoint, SelectionHandleDrag, SelectionHandleEdge } from '../types';
import { clientToSpreadContent } from '../core/wiring-deps';
import {
  captureSelectionInteraction,
  supportsSelectionGestureProjection,
} from '../../interaction/selection/selection-interaction-owner';
import { createSelectionEdgeNavigation } from './selection-edge-navigation';
import {
  claimSelectionInputIntent,
  ownsSelectionIntent,
  startSelectionIntent,
  transferSelectionGesture,
  type SelectionIntentCapture,
} from './selection-spread-transfer';
import type { Internals, Nav, SelectionAccessorsSlice } from './types';

export function buildSelectionAccessors(
  internals: Internals,
  canvas: HTMLCanvasElement,
  nav: Nav,
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
    get selectionSourceSpan() {
      return internals.engines.selection.getSourceSpan();
    },
    beginSelectionHandleDrag(edge, origin) {
      return beginHandleDrag(internals, canvas, nav, edge, origin);
    },
  };
}

function beginHandleDrag(
  internals: Internals,
  canvas: HTMLCanvasElement,
  nav: Nav,
  edge: SelectionHandleEdge,
  origin: SelectionClientPoint,
): SelectionHandleDrag | null {
  if (!isFiniteClientPoint(origin)) return null;
  const selection = internals.engines.selection;
  if (selectionMapperUnavailable(internals) || !selection.getHandleCarets()?.[edge]) return null;
  if (!captureSelectionInteraction(selection)) return null;
  const input = claimSelectionInputIntent(internals, nav);
  if (!input) return null;
  const caret = selection.getHandleCarets()?.[edge];
  if (!input.owns() || selectionMapperUnavailable(internals) || !caret) return null;
  const started = startSelectionIntent(internals, () => selection.beginHandleDrag(edge));
  const drag = started.value;
  if (!drag) return null;
  if (started.kind !== 'captured') {
    drag.cancel();
    return null;
  }
  const intent = started.intent;
  const grabOffset = computeGrabOffset(internals, canvas, caret, origin);
  const toContent = createContentPointResolver(internals, canvas, grabOffset);
  const edgeNavigation = supportsSelectionGestureProjection(selection)
    ? createHandleEdgeNavigation(internals, canvas, nav, drag, toContent, intent)
    : null;
  return createActiveHandleDrag(internals, intent, drag, edgeNavigation, origin, toContent);
}

type EngineHandleDrag = NonNullable<
  ReturnType<Internals['engines']['selection']['beginHandleDrag']>
>;
type ContentPointResolver = (point: SelectionClientPoint) => {
  readonly x: number;
  readonly y: number;
};

function createHandleEdgeNavigation(
  internals: Internals,
  canvas: HTMLCanvasElement,
  nav: Nav,
  drag: EngineHandleDrag,
  toContent: ContentPointResolver,
  intent: SelectionIntentCapture,
): ReturnType<typeof createSelectionEdgeNavigation> {
  return createSelectionEdgeNavigation({
    getSurfaceRect: () => canvas.getBoundingClientRect(),
    getCurrentSpread: () => internals.currentSpread,
    getTotalSpreads: () => internals.reader.totalSpreads,
    canGrowForward: () => internals.reader.pagination?.complete === false,
    navigate: (target, direction, point, signal) =>
      transferSelectionGesture(
        internals,
        nav,
        target,
        direction,
        signal,
        intent,
        () => toContent(point),
        (input) => {
          drag.update(input);
        },
      ),
  });
}

function createActiveHandleDrag(
  internals: Internals,
  intent: SelectionIntentCapture,
  drag: EngineHandleDrag,
  edgeNavigation: ReturnType<typeof createSelectionEdgeNavigation> | null,
  origin: SelectionClientPoint,
  toContent: ContentPointResolver,
): SelectionHandleDrag {
  let active = true;
  let moved = false;
  const cancel = (): void => {
    if (!active) return;
    active = false;
    edgeNavigation?.cancel();
    drag.cancel();
  };
  return {
    update(point) {
      if (!active) return;
      if (!ownsSelectionIntent(internals, intent)) {
        cancel();
        return;
      }
      if (!isFiniteClientPoint(point) || sameClientPoint(point, origin)) return;
      moved = true;
      drag.update(toContent(point));
      if (!ownsSelectionIntent(internals, intent)) {
        cancel();
        return;
      }
      edgeNavigation?.update(point);
    },
    finish(point) {
      if (!active) return;
      active = false;
      edgeNavigation?.cancel();
      if (
        !ownsSelectionIntent(internals, intent) ||
        !isFiniteClientPoint(point) ||
        (!moved && sameClientPoint(point, origin))
      ) {
        drag.cancel();
        return;
      }
      drag.finish(toContent(point));
    },
    cancel,
  };
}

function createContentPointResolver(
  internals: Internals,
  canvas: HTMLCanvasElement,
  offset: GrabOffset,
): ContentPointResolver {
  return (point) =>
    clientToSpreadContent(
      point.clientX - offset.x,
      point.clientY - offset.y,
      canvas.getBoundingClientRect(),
      internals.coordState,
    );
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

function selectionMapperUnavailable(internals: Internals): boolean {
  return internals.coordState.mapper === null;
}

function sameClientPoint(left: SelectionClientPoint, right: SelectionClientPoint): boolean {
  return left.clientX === right.clientX && left.clientY === right.clientY;
}
