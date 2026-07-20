import {
  createPageBufferPoolState,
  disposePageBufferPoolState,
  resizeBufferSlot,
  type PageBufferPoolState,
} from './buffer-pool-state';
import { createInvalidationMethods } from './buffer-pool-invalidation';
import { createProvisionalMethods } from './buffer-pool-provisional';
import { paintOverlayInto } from './overlay-painter';
import type { OverlayLayer, PageBufferSlot, ProvisionalBufferStage, SlotPosition } from './types';

/** Provider function that produces overlay layers for a given spread index. */
export type OverlayProvider = (spreadIndex: number) => readonly OverlayLayer[];

/** Callback matching `reader.renderSpreadTo(index, context)`. */
export type ContentRenderer = (
  spreadIndex: number,
  ctx: OffscreenCanvasRenderingContext2D,
) => boolean;

export type ProvisionalContentRenderer = (ctx: OffscreenCanvasRenderingContext2D) => boolean;

export interface DrawBufferSlot {
  readonly slot: PageBufferSlot;
  readonly provisional: boolean;
  readonly provisionalToken?: number | undefined;
}

/** Three-slot exact ring buffer plus one isolated provisional paint stage. */
export interface PageBufferPool {
  readonly prev: PageBufferSlot;
  readonly curr: PageBufferSlot;
  readonly next: PageBufferSlot;

  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  assignSlot(position: SlotPosition, spreadIndex: number): void;
  ensureContent(position: SlotPosition, renderer: ContentRenderer): boolean;

  beginProvisionalStage(
    mountSpreadIndex: number,
    direction: 'forward' | 'backward',
    onFirstComposite?: () => void,
  ): ProvisionalBufferStage;
  ensureProvisionalStage(token: number, renderer: ProvisionalContentRenderer): boolean;
  refreshProvisionalStage(token: number, renderer: ProvisionalContentRenderer): boolean;
  resolveDrawSlot(position: SlotPosition): DrawBufferSlot;
  notifyProvisionalComposite(token: number): boolean;
  commitProvisionalStage(token: number): boolean;
  beginProvisionalRollback(token: number): boolean;
  completeProvisionalRollback(token: number): boolean;
  finishProvisionalStage(token: number): boolean;
  promoteProvisionalExact(
    token: number,
    position: 'next' | 'prev',
    exactSpreadIndex: number,
  ): boolean;
  finishSameSpreadProvisionalExact(token: number, exactSpreadIndex: number): boolean;
  containProvisionalFailure(token: number, fallbackMountSpreadIndex: number): boolean;
  resetProvisionalState(fallbackMountSpreadIndex: number): void;
  cancelProvisionalStage(token: number): boolean;

  ensureOverlay(position: SlotPosition, provider: OverlayProvider, backingRatio: number): void;
  rotateForward(): void;
  rotateBackward(): void;
  jump(spreadIndex: number): void;
  invalidateAllContent(): void;
  invalidateContentForSpread(spreadIndex: number): void;
  invalidateOverlayForSpread(spreadIndex: number): void;
  invalidateAllOverlays(): void;
  getSlotFor(spreadIndex: number): SlotPosition | null;
  dispose(): void;
}

export function createPageBufferPool(): PageBufferPool {
  const state = createPageBufferPoolState();
  try {
    const pool = createSlotAccessors(state) as PageBufferPool;
    const slotOperations = {
      getSlot,
      clearSlot,
      assignSlot,
      rotateForward,
      rotateBackward,
    };
    Object.assign(
      pool,
      createRenderMethods(state),
      createProvisionalMethods(state, slotOperations),
      createRotationMethods(state),
      createInvalidationMethods(state, slotOperations),
    );
    return pool;
  } catch (error: unknown) {
    try {
      disposePageBufferPoolState(state);
    } catch {
      // Preserve the pool construction error after best-effort cleanup.
    }
    throw error;
  }
}

function getSlot(state: PageBufferPoolState, position: SlotPosition): PageBufferSlot {
  const index = position === 'prev' ? 0 : position === 'curr' ? 1 : 2;
  const slot = state.slots[state.indices[index]];
  if (!slot) throw new Error(`Invalid slot index for position ${position}`);
  return slot;
}

function clearSlot(slot: PageBufferSlot): void {
  slot.spreadIndex = null;
  slot.contentDirty = true;
  slot.overlayDirty = true;
  clearOverlay(slot);
}

function createSlotAccessors(
  state: PageBufferPoolState,
): Pick<PageBufferPool, 'prev' | 'curr' | 'next'> {
  return {
    get prev() {
      return getSlot(state, 'prev');
    },
    get curr() {
      return getSlot(state, 'curr');
    },
    get next() {
      return getSlot(state, 'next');
    },
  };
}

function createRenderMethods(
  state: PageBufferPoolState,
): Pick<PageBufferPool, 'resize' | 'assignSlot' | 'ensureContent' | 'ensureOverlay'> {
  return {
    resize(cssWidth, cssHeight, dpr): void {
      if (state.disposed) return;
      const width = Math.round(cssWidth * dpr);
      const height = Math.round(cssHeight * dpr);
      if (state.width === width && state.height === height) return;
      if (state.provisional) return;
      state.width = width;
      state.height = height;
      for (const slot of state.slots) resizeBufferSlot(slot, width, height);
      resizeBufferSlot(state.provisionalSlot, width, height);
    },
    assignSlot(position, spreadIndex): void {
      if (state.disposed) return;
      assignSlot(state, position, spreadIndex);
    },
    ensureContent(position, renderer): boolean {
      if (state.disposed) return false;
      return ensureContent(state, position, renderer);
    },
    ensureOverlay(position, provider, backingRatio): void {
      if (state.disposed) return;
      ensureOverlay(state, position, provider, backingRatio);
    },
  };
}

function assignSlot(state: PageBufferPoolState, position: SlotPosition, spreadIndex: number): void {
  const slot = getSlot(state, position);
  if (slot === state.provisional?.rollbackSlot) return;
  slot.spreadIndex = spreadIndex;
  slot.contentDirty = true;
  slot.overlayDirty = true;
  clearOverlay(slot);
}

function ensureContent(
  state: PageBufferPoolState,
  position: SlotPosition,
  renderer: ContentRenderer,
): boolean {
  const slot = getSlot(state, position);
  if (slot.spreadIndex === null) return false;
  if (!slot.contentDirty) return true;
  const context = slot.content.getContext('2d');
  if (!context) return false;
  if (!renderer(slot.spreadIndex, context)) return false;
  slot.contentDirty = false;
  return true;
}

function ensureOverlay(
  state: PageBufferPoolState,
  position: SlotPosition,
  provider: OverlayProvider,
  backingRatio: number,
): void {
  const slot = getSlot(state, position);
  if (!slot.overlayDirty || slot.spreadIndex === null) return;
  const layers = provider(slot.spreadIndex);
  if (layers.length === 0) {
    clearOverlay(slot);
    slot.overlayDirty = false;
    return;
  }
  if (!slot.overlay) {
    slot.overlay = new OffscreenCanvas(slot.content.width, slot.content.height);
  }
  const context = slot.overlay.getContext('2d');
  if (!context) return;
  paintOverlayInto(context, layers, backingRatio);
  slot.overlayDirty = false;
}

function clearOverlay(slot: PageBufferSlot): void {
  if (!slot.overlay) return;
  const context = slot.overlay.getContext('2d');
  if (context) {
    context.clearRect(0, 0, slot.overlay.width, slot.overlay.height);
  }
}

function createRotationMethods(
  state: PageBufferPoolState,
): Pick<PageBufferPool, 'rotateForward' | 'rotateBackward' | 'jump'> {
  return {
    rotateForward(): void {
      if (state.disposed) return;
      rotateForward(state);
    },
    rotateBackward(): void {
      if (state.disposed) return;
      rotateBackward(state);
    },
    jump(spreadIndex): void {
      if (state.disposed) return;
      jumpToSpread(state, spreadIndex);
    },
  };
}

function rotateForward(state: PageBufferPoolState): void {
  const oldPrevious = state.indices[0];
  state.indices = [state.indices[1], state.indices[2], oldPrevious] as [number, number, number];
  clearSlot(getSlot(state, 'next'));
}

function rotateBackward(state: PageBufferPoolState): void {
  const oldNext = state.indices[2];
  state.indices = [oldNext, state.indices[0], state.indices[1]] as [number, number, number];
  clearSlot(getSlot(state, 'prev'));
}

function jumpToSpread(state: PageBufferPoolState, spreadIndex: number): void {
  if (state.provisional) {
    throw new Error('Cannot jump while a provisional page buffer owner is active');
  }
  for (const slot of state.slots) clearSlot(slot);
  state.indices = [0, 1, 2];
  assignSlot(state, 'curr', spreadIndex);
}
