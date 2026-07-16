import { wireA11y } from '../wiring/a11y';
import type { WiringDeps } from '../core/wiring-deps';
import type { Internals, Disposables, LifecycleSlice, RuntimeComponents } from './types';
import { releaseImageClickResources } from '../wiring/image-click';
import {
  createDisposableCollection,
  runDisposers,
  type DisposableCollection,
} from '../../utils/disposable';

const READER_SURFACE_ATTRIBUTE = 'data-rito-reader-surface';

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
  const state: LifecycleState = {
    disposed: false,
    mountedContainer: undefined,
    mountDisposables: createDisposableCollection(),
    restoreSurfaceMarker: undefined,
  };
  return {
    mount(container: HTMLElement): void {
      mountLifecycle(state, container, runtime, deps);
    },
    dispose(): void {
      if (state.disposed) return;
      state.disposed = true;
      disposeLifecycle(state, disposables, runtime, deps);
    },
  };
}

interface LifecycleState {
  disposed: boolean;
  mountedContainer: HTMLElement | undefined;
  mountDisposables: DisposableCollection;
  restoreSurfaceMarker: (() => void) | undefined;
}

function mountLifecycle(
  state: LifecycleState,
  container: HTMLElement,
  runtime: RuntimeComponents,
  deps: WiringDeps,
): void {
  if (state.disposed) throw new Error('Cannot mount a disposed reader controller');
  if (state.mountedContainer === container) return;
  const canvas = runtime.surface.canvas;
  const previousParent = canvas.parentNode;
  const previousNextSibling = canvas.nextSibling;
  const previousDisposables = state.mountDisposables;
  const candidateDisposables = createDisposableCollection();
  container.appendChild(canvas);
  try {
    wireA11y(deps, candidateDisposables);
  } catch (error: unknown) {
    try {
      candidateDisposables.disposeAll();
    } catch {
      // Preserve the mount error after best-effort cleanup.
    }
    restoreCanvasPosition(canvas, previousParent, previousNextSibling);
    throw error;
  }
  installSurfaceMarker(state, canvas);
  state.mountDisposables = candidateDisposables;
  state.mountedContainer = container;
  try {
    previousDisposables.disposeAll();
  } catch {
    // The new mount is already authoritative. A broken old disposer must not
    // make the committed mount look as though it failed or strand later cleanup.
  }
}

function installSurfaceMarker(state: LifecycleState, canvas: HTMLCanvasElement): void {
  if (!state.restoreSurfaceMarker) {
    const previous = canvas.getAttribute(READER_SURFACE_ATTRIBUTE);
    state.restoreSurfaceMarker = () => {
      if (previous === null) canvas.removeAttribute(READER_SURFACE_ATTRIBUTE);
      else canvas.setAttribute(READER_SURFACE_ATTRIBUTE, previous);
    };
  }
  canvas.setAttribute(READER_SURFACE_ATTRIBUTE, 'true');
}

function restoreCanvasPosition(
  canvas: HTMLCanvasElement,
  parent: Node | null,
  nextSibling: Node | null,
): void {
  if (!parent) {
    canvas.remove();
    return;
  }
  if (nextSibling?.parentNode === parent) parent.insertBefore(canvas, nextSibling);
  else parent.appendChild(canvas);
}

function disposeLifecycle(
  state: LifecycleState,
  disposables: Disposables,
  runtime: RuntimeComponents,
  deps: WiringDeps,
): void {
  runDisposers([
    () => {
      releaseImageClickResources(deps);
    },
    () => {
      state.mountedContainer = undefined;
      state.mountDisposables.disposeAll();
    },
    () => {
      state.restoreSurfaceMarker?.();
      state.restoreSurfaceMarker = undefined;
    },
    () => {
      disposables.disposeAll();
    },
    () => {
      runtime.disposeSettledEvents();
    },
    () => {
      runtime.prerenderScheduler.dispose();
    },
    () => {
      runtime.frameDriver.dispose();
    },
    () => {
      runtime.pool.dispose();
    },
  ]);
}
