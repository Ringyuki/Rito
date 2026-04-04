import { renderLayers } from './render';
import type { OverlayLayer, OverlayRenderer } from './types';

export type { OverlayLayer, OverlayRenderer, Rect } from './types';

interface OverlayState {
  ctx: CanvasRenderingContext2D | null;
  width: number;
  height: number;
  dpr: number;
  mounted: boolean;
}

function createOverlayCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  return canvas;
}

function syncSize(canvas: HTMLCanvasElement, state: OverlayState): void {
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  canvas.style.width = `${String(state.width)}px`;
  canvas.style.height = `${String(state.height)}px`;
}

export function createOverlayRenderer(): OverlayRenderer {
  const canvas = createOverlayCanvas();
  const state: OverlayState = { ctx: null, width: 0, height: 0, dpr: 1, mounted: false };

  return {
    mount(container: HTMLElement): void {
      if (state.mounted) return;
      container.appendChild(canvas);
      state.ctx = canvas.getContext('2d');
      state.mounted = true;
    },

    setSize(width: number, height: number, dpr: number): void {
      state.width = width;
      state.height = height;
      state.dpr = dpr;
      syncSize(canvas, state);
    },

    render(layers: readonly OverlayLayer[]): void {
      if (!state.ctx) return;
      renderLayers(state.ctx, state.width, state.height, state.dpr, layers);
    },

    clear(): void {
      state.ctx?.clearRect(0, 0, canvas.width, canvas.height);
    },

    get canvas(): HTMLCanvasElement {
      return canvas;
    },

    dispose(): void {
      if (state.mounted) {
        canvas.remove();
        state.mounted = false;
      }
      state.ctx = null;
    },
  };
}
