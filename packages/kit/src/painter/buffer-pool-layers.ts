import type { PageBufferPoolState } from './buffer-pool-state';
import type { GlCompositor, QuadRect } from './gl/compositor';
import { createPageTarget, sizePageTarget, uploadCanvas } from './gl/targets';
import { paintOverlayInto } from './overlay-painter';
import type { OverlayLayer, PageBufferSlot } from './types';

/** A page as one texture, its overlay over it. */
export interface PageTexture {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

/** Copies what the host drew on the host layer into the page's own framebuffer. */
export function layHost(
  state: PageBufferPoolState,
  compositor: GlCompositor,
  slot: PageBufferSlot,
): void {
  if (!state.host) return;
  const { content } = slot;
  uploadCanvas(state.gl, state.host.texture, state.host.canvas);
  compositor.bind(content.framebuffer, content.width, content.height);
  compositor.drawTexture(state.host.texture, rectOf(content));
}

export function hostLayer(
  state: PageBufferPoolState,
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D {
  state.host ??= { canvas: new OffscreenCanvas(width, height), texture: state.gl.createTexture() };
  const { canvas } = state.host;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error("A 2D canvas for the host's painter is unavailable");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

export function ensureOverlay(
  state: PageBufferPoolState,
  slot: PageBufferSlot,
  provider: (spreadIndex: number) => readonly OverlayLayer[],
  backingRatio: number,
): void {
  if (!slot.overlayDirty || slot.spreadIndex === null) return;
  const layers = provider(slot.spreadIndex);
  slot.overlayDirty = false;
  if (layers.length === 0) {
    clearOverlay(slot);
    return;
  }
  const { width, height } = slot.content;
  slot.overlay ??= {
    canvas: new OffscreenCanvas(width, height),
    texture: state.gl.createTexture(),
  };
  const context = slot.overlay.canvas.getContext('2d');
  if (!context) return;
  paintOverlayInto(context, layers, backingRatio);
  uploadCanvas(state.gl, slot.overlay.texture, slot.overlay.canvas);
  slot.overlayShown = true;
  slot.composedAt = -1;
  slot.paints += 1;
}

export function clearOverlay(slot: PageBufferSlot): void {
  if (!slot.overlayShown) return;
  slot.overlayShown = false;
  slot.composedAt = -1;
  slot.paints += 1;
}

export function pageTexture(
  state: PageBufferPoolState,
  compositor: GlCompositor,
  slot: PageBufferSlot,
): PageTexture {
  const { content } = slot;
  if (slot.composed?.width !== content.width || slot.composed.height !== content.height) {
    if (slot.composed) sizePageTarget(state.gl, slot.composed, content.width, content.height);
    else slot.composed = createPageTarget(state.gl, content.width, content.height);
    slot.composedAt = -1;
  }
  const composed = slot.composed;
  if (slot.composedAt !== slot.paints) {
    compositor.bind(composed.framebuffer, composed.width, composed.height);
    compositor.clear();
    compositor.drawTexture(content.texture, rectOf(composed));
    if (slot.overlay && slot.overlayShown) {
      compositor.drawTexture(slot.overlay.texture, rectOf(composed));
    }
    slot.composedAt = slot.paints;
  }
  return composed;
}

function rectOf(target: { readonly width: number; readonly height: number }): QuadRect {
  return { x: 0, y: 0, width: target.width, height: target.height };
}
