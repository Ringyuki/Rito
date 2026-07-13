import { wireA11y } from '../wiring/a11y';
import type { WiringDeps } from '../core/wiring-deps';
import type { Internals, Disposables, LifecycleSlice, RuntimeComponents } from './types';
import { releaseImageClickResources } from '../wiring/image-click';

export function syncCanvasSize(internals: Internals, runtime: RuntimeComponents): void {
  // getCanvasSize(renderScale) returns CSS dimensions that already include renderScale.
  // Backing store = CSS × DPR only — do NOT multiply renderScale again.
  const size = internals.reader.getCanvasSize(internals.renderScale);
  const dpr = internals.reader.dpr;
  if (shouldResizeSurface(runtime, size.width, size.height, dpr)) {
    runtime.surface.setSize(size.width, size.height, dpr);
  }
  runtime.pool.resize(size.width, size.height, dpr);
  runtime.td.viewportWidth = size.width;
}

function shouldResizeSurface(
  runtime: RuntimeComponents,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): boolean {
  return (
    runtime.surface.width !== Math.round(cssWidth * dpr) ||
    runtime.surface.height !== Math.round(cssHeight * dpr)
  );
}

export function buildLifecycle(
  disposables: Disposables,
  runtime: RuntimeComponents,
  deps: WiringDeps,
): LifecycleSlice {
  return {
    mount(container: HTMLElement): void {
      container.appendChild(runtime.surface.canvas);
      wireA11y(deps, disposables);
    },
    dispose(): void {
      releaseImageClickResources(deps);
      disposables.disposeAll();
      runtime.frameDriver.dispose();
    },
  };
}
