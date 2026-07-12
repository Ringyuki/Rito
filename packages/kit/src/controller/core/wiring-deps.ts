import type { Reader } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { CoordinatorEngines, CoordinatorState } from './coordinator-state';
import type { ControllerOptions, ReaderControllerEvents } from '../types';
import type { Internals } from './internals';
import type { NavigationActions } from '../navigation/index';
import type { PositionPersistence } from '../position-persistence';

export interface WiringDeps {
  reader: Reader;
  engines: CoordinatorEngines;
  emitter: TypedEmitter<ReaderControllerEvents>;
  frameDriver: FrameDriver;
  options: ControllerOptions;
  coordState: CoordinatorState;
  canvas: HTMLCanvasElement;
  getCurrentSpread: () => number;
  setCurrentSpread: (idx: number) => void;
  getRenderScale: () => number;
  positionPersistence: PositionPersistence;
  /** Navigate to a spread with transition animation. */
  goToSpread: (index: number) => void;
  /**
   * `true` once {@link ReaderController.restorePosition} has resolved at least once.
   * `wirePositionTracker` reads this to suppress automatic `positionStorage.save`
   * calls before the consumer has had a chance to hydrate, avoiding overwrites of
   * the persisted position with the controller's own initial spread-0 event.
   */
  hasRestored: () => boolean;
  /** Continue a deferred navigation once an async content slot is ready. */
  notifyNavigationContentReady: (index: number) => void;
  /** Sync viewport-sized buffers before painting a current-spread visual refresh. */
  syncViewport?: () => void;
}

/** Build a WiringDeps object from internals + runtime components. */
export function buildWiringDeps(
  internals: Internals,
  emitter: TypedEmitter<ReaderControllerEvents>,
  frameDriver: FrameDriver,
  canvas: HTMLCanvasElement,
  nav: NavigationActions,
  syncViewport?: () => void,
): WiringDeps {
  const deps: WiringDeps = {
    reader: internals.reader,
    engines: internals.engines,
    emitter,
    frameDriver,
    options: internals.options,
    coordState: internals.coordState,
    canvas,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (i) => {
      internals.currentSpread = i;
    },
    getRenderScale: () => internals.renderScale,
    positionPersistence: internals.positionPersistence,
    goToSpread: (i) => {
      nav.goToSpread(i);
    },
    hasRestored: () => internals.restoreCompleted,
    notifyNavigationContentReady: (i) => {
      nav.notifyContentReady(i);
    },
  };
  if (syncViewport) return { ...deps, syncViewport };
  return deps;
}

/** Convert a PointerEvent to spread-content coordinates via the mapper. */
export function toSpreadContent(
  e: PointerEvent,
  canvas: HTMLCanvasElement,
  coordState: CoordinatorState,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return clientToSpreadContent(e.clientX, e.clientY, rect, coordState);
}

/** Convert client coordinates to spread-content coordinates using a pre-computed rect. */
export function clientToSpreadContent(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  coordState: CoordinatorState,
): { x: number; y: number } {
  const cssX = clientX - rect.left;
  const cssY = clientY - rect.top;
  if (!coordState.mapper) return { x: cssX, y: cssY };
  return coordState.mapper.cssToSpreadContent(cssX, cssY);
}
