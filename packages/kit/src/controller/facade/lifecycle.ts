import type { Reader } from '@rito/core';
import { wireA11y } from '../wiring/a11y';
import type { ControllerOptions } from '../types';
import type { CoordinatorState } from '../core/coordinator-state';
import type { Internals, Disposables, LifecycleSlice, RuntimeComponents } from './types';

export function syncCanvasSize(internals: Internals, runtime: RuntimeComponents): void {
  // getCanvasSize(renderScale) returns CSS dimensions that already include renderScale.
  // Backing store = CSS × DPR only — do NOT multiply renderScale again.
  const size = internals.reader.getCanvasSize(internals.renderScale);
  const dpr = internals.reader.dpr;
  runtime.surface.setSize(size.width, size.height, dpr);
  runtime.pool.resize(size.width, size.height, dpr);
  runtime.td.viewportWidth = size.width;
}

export function buildLifecycle(
  disposables: Disposables,
  runtime: RuntimeComponents,
  coordState: CoordinatorState,
  opts: ControllerOptions,
  canvas: HTMLCanvasElement,
  reader: Reader,
): LifecycleSlice {
  return {
    mount(container: HTMLElement): void {
      container.appendChild(runtime.surface.canvas);
      wireA11y(opts, canvas, reader, disposables);
    },
    dispose(): void {
      if (coordState.activeImageBlobUrl) {
        URL.revokeObjectURL(coordState.activeImageBlobUrl);
        coordState.activeImageBlobUrl = null;
      }
      disposables.disposeAll();
      runtime.frameDriver.dispose();
    },
  };
}
