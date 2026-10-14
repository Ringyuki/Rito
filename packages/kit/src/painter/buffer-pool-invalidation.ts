import { disposePageBufferPoolState, type PageBufferPoolState } from './buffer-pool-state';
import type { PageBufferPool } from './buffer-pool';
import type { PageBufferSlot, SlotPosition } from './types';

export interface BufferInvalidationOperations {
  readonly getSlot: (state: PageBufferPoolState, position: SlotPosition) => PageBufferSlot;
}

type InvalidationMethods = Pick<
  PageBufferPool,
  | 'invalidateAllContent'
  | 'invalidateContentForSpread'
  | 'invalidateOverlayForSpread'
  | 'invalidateAllOverlays'
  | 'getSlotFor'
  | 'dispose'
>;

export function createInvalidationMethods(
  state: PageBufferPoolState,
  operations: BufferInvalidationOperations,
): InvalidationMethods {
  return {
    invalidateAllContent(): void {
      if (state.disposed) return;
      for (const slot of state.slots) {
        slot.contentDirty = true;
        slot.overlayDirty = true;
      }
    },
    invalidateContentForSpread(spreadIndex): void {
      if (state.disposed) return;
      for (const slot of state.slots) {
        if (slot.spreadIndex !== spreadIndex) continue;
        slot.contentDirty = true;
        slot.overlayDirty = true;
      }
    },
    invalidateOverlayForSpread(spreadIndex): void {
      if (state.disposed) return;
      for (const slot of state.slots) {
        if (slot.spreadIndex === spreadIndex) slot.overlayDirty = true;
      }
    },
    invalidateAllOverlays(): void {
      if (state.disposed) return;
      for (const slot of state.slots) {
        if (slot.spreadIndex !== null) slot.overlayDirty = true;
      }
    },
    getSlotFor(spreadIndex): SlotPosition | null {
      return findSlotForSpread(state, operations, spreadIndex);
    },
    dispose(): void {
      disposePageBufferPoolState(state);
    },
  };
}

function findSlotForSpread(
  state: PageBufferPoolState,
  operations: BufferInvalidationOperations,
  spreadIndex: number,
): SlotPosition | null {
  if (state.disposed) return null;
  const current = operations.getSlot(state, 'curr');
  if (current.spreadIndex === spreadIndex) return 'curr';
  if (operations.getSlot(state, 'prev').spreadIndex === spreadIndex) return 'prev';
  if (operations.getSlot(state, 'next').spreadIndex === spreadIndex) return 'next';
  return null;
}
