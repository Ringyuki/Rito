import { runDisposers } from '../utils/disposable';
import type { PageBufferSlot } from './types';

export interface ProvisionalStageState {
  readonly token: number;
  readonly mountSpreadIndex: number;
  readonly direction: 'forward' | 'backward';
  readonly slot: PageBufferSlot;
  readonly onFirstComposite: (() => void) | undefined;
  phase: 'incoming' | 'committed' | 'rollingBack';
  rollbackSlot: PageBufferSlot | undefined;
  compositeNotified: boolean;
}

export interface PageBufferPoolState {
  readonly slots: [PageBufferSlot, PageBufferSlot, PageBufferSlot];
  readonly provisionalSlot: PageBufferSlot;
  provisional: ProvisionalStageState | undefined;
  nextProvisionalToken: number;
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
    const provisional = createSlot(created);
    return {
      slots: [first, second, third],
      provisionalSlot: provisional,
      provisional: undefined,
      nextProvisionalToken: 0,
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
  releaseSlot(state.provisionalSlot);
  state.provisional = undefined;
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
