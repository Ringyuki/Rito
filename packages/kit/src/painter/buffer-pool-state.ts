import { runDisposers } from '../utils/disposable';
import type { PageBufferSlot } from './types';

export interface PageBufferPoolState {
  readonly slots: [PageBufferSlot, PageBufferSlot, PageBufferSlot];
  indices: [number, number, number];
  width: number;
  height: number;
  disposed: boolean;
}

export function createPageBufferPoolState(): PageBufferPoolState {
  const created: PageBufferSlot[] = [];
  try {
    const first = createSlot(created);
    const second = createSlot(created);
    const third = createSlot(created);
    return {
      slots: [first, second, third],
      indices: [0, 1, 2],
      width: 1,
      height: 1,
      disposed: false,
    };
  } catch (error: unknown) {
    try {
      releaseSlots(created);
    } catch {
      // Preserve the allocation error after best-effort cleanup.
    }
    throw error;
  }
}

export function resizeBufferSlot(slot: PageBufferSlot, width: number, height: number): void {
  slot.content.width = width;
  slot.content.height = height;
  if (slot.overlay) {
    slot.overlay.width = width;
    slot.overlay.height = height;
  }
  slot.contentDirty = true;
  slot.overlayDirty = true;
}

export function disposePageBufferPoolState(state: PageBufferPoolState): void {
  if (state.disposed) return;
  state.disposed = true;
  releaseSlots(state.slots);
  state.width = 0;
  state.height = 0;
}

function createSlot(created: PageBufferSlot[]): PageBufferSlot {
  const slot: PageBufferSlot = {
    spreadIndex: null,
    content: new OffscreenCanvas(1, 1),
    overlay: null,
    contentDirty: true,
    overlayDirty: true,
  };
  created.push(slot);
  return slot;
}

function releaseSlots(slots: readonly PageBufferSlot[]): void {
  runDisposers(
    slots.map((slot) => () => {
      releaseSlot(slot);
    }),
  );
}

function releaseSlot(slot: PageBufferSlot): void {
  slot.spreadIndex = null;
  resizeBufferSlot(slot, 0, 0);
  slot.overlay = null;
}
