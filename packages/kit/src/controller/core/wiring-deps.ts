import type { Reader } from 'rito';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { CoordinatorEngines, CoordinatorState } from './coordinator-state';
import type { ControllerOptions, ReaderControllerEvents } from '../types';

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
  /** Navigate to a spread with transition animation. */
  goToSpread: (index: number) => void;
}

/** Convert a PointerEvent to spread-content coordinates via the mapper. */
export function toSpreadContent(
  e: PointerEvent,
  canvas: HTMLCanvasElement,
  coordState: CoordinatorState,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  if (!coordState.mapper) return { x: cssX, y: cssY };
  return coordState.mapper.cssToSpreadContent(cssX, cssY);
}
