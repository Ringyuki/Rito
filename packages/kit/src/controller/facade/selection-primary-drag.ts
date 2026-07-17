import type { SelectionClientPoint } from '../types';
import { clientToSpreadContent } from '../core/wiring-deps';
import {
  ownsSelectionGesture,
  supportsSelectionGestureProjection,
  type SelectionGestureLease,
} from '../../interaction/selection/selection-interaction-owner';
import type {
  PrimarySelectionDragNavigation,
  PrimarySelectionDragSession,
  PrimarySelectionInputIntent,
} from '../wiring/selection-drag';
import {
  createSelectionEdgeNavigation,
  resolveSelectionEdgeDirection,
  type SelectionEdgeNavigation,
} from './selection-edge-navigation';
import {
  claimSelectionInputIntent,
  clampToVisibleEdge,
  isSelectionIntentSuperseded,
  ownsSelectionIntent,
  startSelectionIntent,
  transferSelectionGesture,
  type SelectionIntentCapture,
  type SelectionContentPoint,
} from './selection-spread-transfer';
import type { Internals, Nav } from './types';

/** Build edge navigation for primary mouse/pen and touch long-press selection drags. */
export function createPrimarySelectionDragNavigation(
  internals: Internals,
  canvas: HTMLCanvasElement,
  nav: Nav,
): PrimarySelectionDragNavigation {
  const inputs = new WeakSet<PrimarySelectionInputIntent>();
  return {
    claim() {
      const input = claimSelectionInputIntent(internals, nav);
      if (input) inputs.add(input);
      return input;
    },
    begin(input, startSelection) {
      if (!inputs.has(input) || !input.owns()) return rejectedPrimaryDragSession();
      const started = startSelectionIntent(internals, startSelection);
      if (started.kind === 'unmanaged') return null;
      if (started.kind === 'rejected') {
        return rejectedPrimaryDragSession(started.cancellationGesture);
      }
      return createPrimaryDragSession(internals, canvas, nav, started.intent);
    },
  };
}

function createPrimaryDragSession(
  internals: Internals,
  canvas: HTMLCanvasElement,
  nav: Nav,
  intent: SelectionIntentCapture,
): PrimarySelectionDragSession {
  let active = true;
  let navigated = false;
  const initialSpread = internals.currentSpread;
  const edgeNavigation = supportsSelectionGestureProjection(internals.engines.selection)
    ? createPrimaryEdgeNavigation(internals, canvas, nav, intent, () => {
        navigated = true;
      })
    : null;
  return {
    update(point) {
      if (active && ownsSelectionIntent(internals, intent) && isFiniteClientPoint(point)) {
        edgeNavigation?.update(point);
      }
    },
    finish() {
      if (!active) return false;
      active = false;
      edgeNavigation?.cancel();
      return ownsSelectionIntent(internals, intent);
    },
    cancel() {
      if (active) {
        active = false;
        edgeNavigation?.cancel();
      }
      return ownsSelectionGesture(intent.gesture);
    },
    owns: () => active && ownsSelectionIntent(internals, intent),
    resolveFinalInput: (point) =>
      resolveFinalInput(
        internals,
        canvas,
        point,
        navigated || internals.currentSpread !== initialSpread,
      ),
    wasSuperseded: () => isSelectionIntentSuperseded(internals, intent),
    didNavigate: () => navigated || internals.currentSpread !== initialSpread,
  };
}

function resolveFinalInput(
  internals: Internals,
  canvas: HTMLCanvasElement,
  point: SelectionClientPoint,
  changedSpread: boolean,
): SelectionContentPoint {
  const input = resolveContentPoint(internals, canvas, point);
  if (!changedSpread) return input;
  const direction = resolveSelectionEdgeDirection(point, canvas.getBoundingClientRect());
  return direction === null ? input : clampToVisibleEdge(internals, input, direction);
}

function createPrimaryEdgeNavigation(
  internals: Internals,
  canvas: HTMLCanvasElement,
  nav: Nav,
  intent: SelectionIntentCapture,
  onSpreadTransfer: () => void,
): SelectionEdgeNavigation {
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
        () => resolveContentPoint(internals, canvas, point),
        (input) => {
          internals.engines.selection.handlePointerMove(input);
        },
        onSpreadTransfer,
      ),
  });
}

function rejectedPrimaryDragSession(
  cancellationGesture?: SelectionGestureLease,
): PrimarySelectionDragSession {
  return {
    update() {},
    finish: () => false,
    cancel: () => (cancellationGesture ? ownsSelectionGesture(cancellationGesture) : false),
    owns: () => false,
    wasSuperseded: () => true,
    didNavigate: () => false,
  };
}

function resolveContentPoint(
  internals: Internals,
  canvas: HTMLCanvasElement,
  point: SelectionClientPoint,
): { readonly x: number; readonly y: number } {
  return clientToSpreadContent(
    point.clientX,
    point.clientY,
    canvas.getBoundingClientRect(),
    internals.coordState,
  );
}

function isFiniteClientPoint(point: SelectionClientPoint): boolean {
  return Number.isFinite(point.clientX) && Number.isFinite(point.clientY);
}
