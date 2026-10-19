import { runDisposers } from '../utils/disposable';
import { createPageTarget, deletePageTarget, sizePageTarget } from './gl/targets';
import type { PageBufferSlot } from './types';

export interface PageBufferPoolState {
  readonly gl: WebGL2RenderingContext;
  readonly slots: [PageBufferSlot, PageBufferSlot, PageBufferSlot];
  /** The canvas a host's painter draws a page on, and the texture it is copied in through; made on first use. */
  host: { readonly canvas: OffscreenCanvas; readonly texture: WebGLTexture } | null;
  indices: [number, number, number];
  width: number;
  height: number;
  disposed: boolean;
}

export function createPageBufferPoolState(gl: WebGL2RenderingContext): PageBufferPoolState {
  const created: PageBufferSlot[] = [];
  try {
    const first = createSlot(gl, created);
    const second = createSlot(gl, created);
    const third = createSlot(gl, created);
    return {
      gl,
      slots: [first, second, third],
      host: null,
      indices: [0, 1, 2],
      width: 1,
      height: 1,
      disposed: false,
    };
  } catch (error: unknown) {
    try {
      releaseSlots(gl, created);
    } catch {
      // Preserve the allocation error after best-effort cleanup.
    }
    throw error;
  }
}

export function resizeBufferSlot(
  gl: WebGL2RenderingContext,
  slot: PageBufferSlot,
  width: number,
  height: number,
): void {
  sizePageTarget(gl, slot.content, width, height);
  if (slot.overlay) {
    slot.overlay.canvas.width = width;
    slot.overlay.canvas.height = height;
  }
  if (slot.composed) {
    deletePageTarget(gl, slot.composed);
    slot.composed = null;
  }
  slot.composedAt = -1;
  slot.contentDirty = true;
  slot.overlayDirty = true;
  slot.paints += 1;
}

export function disposePageBufferPoolState(state: PageBufferPoolState): void {
  if (state.disposed) return;
  state.disposed = true;
  releaseSlots(state.gl, state.slots);
  if (state.host) state.gl.deleteTexture(state.host.texture);
  state.host = null;
  state.width = 0;
  state.height = 0;
}

function createSlot(gl: WebGL2RenderingContext, created: PageBufferSlot[]): PageBufferSlot {
  const slot: PageBufferSlot = {
    spreadIndex: null,
    content: createPageTarget(gl, 1, 1),
    overlay: null,
    composed: null,
    composedAt: -1,
    contentDirty: true,
    overlayDirty: true,
    overlayShown: false,
    paints: 0,
  };
  created.push(slot);
  return slot;
}

function releaseSlots(gl: WebGL2RenderingContext, slots: readonly PageBufferSlot[]): void {
  runDisposers(
    slots.map((slot) => () => {
      releaseSlot(gl, slot);
    }),
  );
}

function releaseSlot(gl: WebGL2RenderingContext, slot: PageBufferSlot): void {
  slot.spreadIndex = null;
  deletePageTarget(gl, slot.content);
  if (slot.overlay) gl.deleteTexture(slot.overlay.texture);
  if (slot.composed) deletePageTarget(gl, slot.composed);
  slot.overlay = null;
  slot.composed = null;
}
