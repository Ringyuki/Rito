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
  // Cache canvas rect for the duration of a touch gesture to avoid
  // repeated getBoundingClientRect calls during high-frequency touchmove events.
  let cachedRect: DOMRect | null = null;
  const cacheCanvasRect = (): void => {
    cachedRect = canvas.getBoundingClientRect();
  };
  const clearCanvasRect = (): void => {
    cachedRect = null;
  };
  const touchToContent = (touch: Touch) =>
    clientToSpreadContent(
      touch.clientX,
      touch.clientY,
      cachedRect ?? canvas.getBoundingClientRect(),
      internals.coordState,
    );

  const gestureDeps: GestureDeps = {
    td: runtime.td,
    frameDriver: runtime.frameDriver,
    goToSpread: (i) => {
      nav.goToSpread(i);
    },
    getCurrentSpread: () => internals.currentSpread,
    getTotalSpreads: () => reader.totalSpreads,
    commitPendingTransition: () => {
      if (runtime.td.isAnimating) {
        runtime.td.forceSettle();
      }
    },
  };

  const wiringDeps = buildWiringDeps(internals, emitter, runtime.frameDriver, canvas, nav);

  const handleTap = (pos: { x: number; y: number }) => {
    dispatchClick(pos, wiringDeps);
  };

  canvas.addEventListener('touchstart', cacheCanvasRect, { passive: true });
  canvas.addEventListener('touchend', clearCanvasRect);
  canvas.addEventListener('touchcancel', clearCanvasRect);
  disposables.add(() => {
    canvas.removeEventListener('touchstart', cacheCanvasRect);
    canvas.removeEventListener('touchend', clearCanvasRect);
    canvas.removeEventListener('touchcancel', clearCanvasRect);
  });

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
