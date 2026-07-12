import type { Reader } from '@ritojs/core';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { DisposableCollection } from '../../utils/disposable';
import type { ReaderControllerEvents } from '../types';
import type { Internals } from '../core/internals';
import type { RuntimeComponents } from '../facade/types';
import type { NavigationActions } from '../navigation/index';
import type { InteractionModeManager } from '../interaction-mode/index';
import type { GestureDeps } from './gesture';
import { clientToSpreadContent } from '../core/wiring-deps';
import { buildWiringDeps } from '../core/wiring-deps';
import { dispatchClick } from './click-dispatch';
import { wireUnifiedTouchHandler } from './gesture';

/**
 * Wire touch gesture handling: canvas rect caching, gesture deps,
 * and unified touch handler (swipe + long-press + tap).
 */
export function wireTouchGestures(
  internals: Internals,
  runtime: RuntimeComponents,
  modeManager: InteractionModeManager,
  emitter: TypedEmitter<ReaderControllerEvents>,
  nav: NavigationActions,
  reader: Reader,
  canvas: HTMLCanvasElement,
  disposables: DisposableCollection,
): void {
  const touchRect = wireTouchRectCache(canvas, disposables);
  const touchToContent = createTouchMapper(canvas, internals, touchRect);
  const gestureDeps = createGestureDeps(runtime, nav, internals, reader);
  const wiringDeps = buildWiringDeps(internals, emitter, runtime.frameDriver, canvas, nav);
  const handleTap = (pos: { x: number; y: number }) => {
    dispatchClick(pos, wiringDeps);
  };

  wireUnifiedTouchHandler(
    canvas,
    gestureDeps,
    internals.engines.selection,
    modeManager,
    touchToContent,
    handleTap,
    disposables,
  );
}

function wireTouchRectCache(
  canvas: HTMLCanvasElement,
  disposables: DisposableCollection,
): { current: DOMRect | null } {
  const rect = { current: null as DOMRect | null };
  const cacheCanvasRect = (): void => {
    rect.current = canvas.getBoundingClientRect();
  };
  const clearCanvasRect = (): void => {
    rect.current = null;
  };
  canvas.addEventListener('touchstart', cacheCanvasRect, { passive: true });
  canvas.addEventListener('touchend', clearCanvasRect);
  canvas.addEventListener('touchcancel', clearCanvasRect);
  disposables.add(() => {
    canvas.removeEventListener('touchstart', cacheCanvasRect);
    canvas.removeEventListener('touchend', clearCanvasRect);
    canvas.removeEventListener('touchcancel', clearCanvasRect);
  });
  return rect;
}

function createTouchMapper(
  canvas: HTMLCanvasElement,
  internals: Internals,
  cachedRect: { readonly current: DOMRect | null },
): (touch: Touch) => { x: number; y: number } {
  return (touch) =>
    clientToSpreadContent(
      touch.clientX,
      touch.clientY,
      cachedRect.current ?? canvas.getBoundingClientRect(),
      internals.coordState,
    );
}

function createGestureDeps(
  runtime: RuntimeComponents,
  nav: NavigationActions,
  internals: Internals,
  reader: Reader,
): GestureDeps {
  return {
    td: runtime.td,
    frameDriver: runtime.frameDriver,
    startGestureNavigation: (index, onTransitionStart) => {
      return nav.startGestureNavigation(index, onTransitionStart);
    },
    getCurrentSpread: () => internals.currentSpread,
    getTotalSpreads: () => reader.totalSpreads,
    commitPendingTransition: () => {
      if (runtime.td.isAnimating) runtime.td.forceSettle();
    },
  };
}
