import type { SelectionClientPoint, SelectionHandleDrag, SelectionHandleEdge } from '../types';
import { clientToSpreadContent } from '../core/wiring-deps';
import {
  createSelectionEdgeNavigation,
  type SelectionEdgeDirection,
  type SelectionEdgeNavigationOutcome,
} from './selection-edge-navigation';
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
  const mapper = internals.coordState.mapper;
  const caret = internals.engines.selection.getHandleCarets()?.[edge];
  if (!mapper || !caret) return null;
  const drag = internals.engines.selection.beginHandleDrag(edge);
  if (!drag) return null;
  const grabOffset = computeGrabOffset(internals, canvas, caret, origin);
  const toContent = createContentPointResolver(internals, canvas, grabOffset);
  const edgeNavigation = createHandleEdgeNavigation(internals, canvas, nav, drag, toContent);
  return createActiveHandleDrag(drag, edgeNavigation, origin, toContent);
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
): ReturnType<typeof createSelectionEdgeNavigation> {
  return createSelectionEdgeNavigation({
    getSurfaceRect: () => canvas.getBoundingClientRect(),
    getCurrentSpread: () => internals.currentSpread,
    getTotalSpreads: () => internals.reader.totalSpreads,
    navigate: (target, direction, point) =>
      transferHandleDrag(internals, nav, drag, target, direction, () => toContent(point)),
  });
}

function createActiveHandleDrag(
  drag: EngineHandleDrag,
  edgeNavigation: ReturnType<typeof createSelectionEdgeNavigation>,
  origin: SelectionClientPoint,
  toContent: ContentPointResolver,
): SelectionHandleDrag {
  let active = true;
  let moved = false;
  return {
    update(point) {
      if (!active || !isFiniteClientPoint(point) || sameClientPoint(point, origin)) return;
      moved = true;
      drag.update(toContent(point));
      edgeNavigation.update(point);
    },
    finish(point) {
      if (!active) return;
      active = false;
      edgeNavigation.cancel();
      if (!isFiniteClientPoint(point) || (!moved && sameClientPoint(point, origin))) {
        drag.cancel();
        return;
      }
      drag.finish(toContent(point));
    },
    cancel() {
      if (!active) return;
      active = false;
      edgeNavigation.cancel();
      drag.cancel();
    },
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

function transferHandleDrag(
  internals: Internals,
  nav: Nav,
  drag: EngineHandleDrag,
  target: number,
  direction: SelectionEdgeDirection,
  resolveInput: () => { readonly x: number; readonly y: number },
): SelectionEdgeNavigationOutcome {
  const readiness = nav.prepareSpreadForJump(target);
  if (readiness !== 'ready') return readiness === 'not-ready' ? 'retry' : 'stop';
  const outcome = nav.jumpToSpreadIfReady(target, true);
  if (outcome !== 'committed') return outcome === 'not-ready' ? 'retry' : 'stop';
  drag.update(clampToVisibleEdge(internals, resolveInput(), direction));
  return 'committed';
}

function clampToVisibleEdge(
  internals: Internals,
  input: { readonly x: number; readonly y: number },
  direction: SelectionEdgeDirection,
): { readonly x: number; readonly y: number } {
  const pages = internals.coordState.mapper?.getPages() ?? [];
  const page = direction === 1 ? pages.at(-1) : pages[0];
  if (!page) return input;
  return {
    x: clamp(input.x, page.spreadContentOriginX, page.spreadContentOriginX + page.contentWidth),
    y: clamp(input.y, 0, page.contentHeight),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
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
