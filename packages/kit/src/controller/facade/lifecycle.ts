import type { Internals, Disposables, Transition, Overlay, LifecycleSlice } from './types';

export function syncCanvasSize(
  internals: Internals,
  transition: Transition,
  overlay: Overlay,
): void {
  const size = internals.reader.getCanvasSize(internals.renderScale);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  transition.setSize(size.width, size.height, dpr);
  overlay.setSize(size.width, size.height, dpr);
}

export function buildLifecycle(
  disposables: Disposables,
  transition: Transition,
  overlay: Overlay,
): LifecycleSlice {
  return {
    mount(container: HTMLElement): void {
      transition.mount(container);
      const wrapper = transition.mainCanvas.parentElement;
      if (wrapper) overlay.mount(wrapper);
    },
    dispose(): void {
      disposables.disposeAll();
      overlay.dispose();
      transition.dispose();
    },
  };
}
