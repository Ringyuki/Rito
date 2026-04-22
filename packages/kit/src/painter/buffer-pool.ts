import type { OverlayLayer, PageBufferSlot, SlotPosition } from './types';
import { paintOverlayInto } from './overlay-painter';

/**
 * Provider function that produces overlay layers for a given spread index.
 * Injected by the controller — decoupled from the pool.
 */
export type OverlayProvider = (spreadIndex: number) => readonly OverlayLayer[];

/**
 * Callback to render a spread's content into a context.
 * Matches `reader.renderSpreadTo(index, ctx)`.
 */
export type ContentRenderer = (spreadIndex: number, ctx: OffscreenCanvasRenderingContext2D) => void;

/** Three-slot ring buffer for page content + overlay sub-buffers. */
export interface PageBufferPool {
  /** Current slot assignments. */
  readonly prev: PageBufferSlot;
  readonly curr: PageBufferSlot;
  readonly next: PageBufferSlot;

  /** Resize all slot backing stores. Backing = CSS × DPR. Marks all content dirty. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void;

  /** Assign a spread index to a named slot position. Marks content + overlay dirty. */
  assignSlot(position: SlotPosition, spreadIndex: number): void;

  /** Ensure a slot's content is up to date. Calls renderer if dirty. */
  ensureContent(position: SlotPosition, renderer: ContentRenderer): void;

  /** Ensure a slot's overlay is up to date. Creates overlay buffer lazily. */
  ensureOverlay(position: SlotPosition, provider: OverlayProvider, backingRatio: number): void;

  /** Rotate slots forward: prev ← curr, curr ← next, next becomes empty + dirty. */
  rotateForward(): void;

  /** Rotate slots backward: next ← curr, curr ← prev, prev becomes empty + dirty. */
  rotateBackward(): void;

  /** Jump to a target spread. Clears all slots, assigns curr to target. */
  jump(spreadIndex: number): void;

  /** Mark all content slots as dirty (e.g. after resize or theme change). */
  invalidateAllContent(): void;

  /** Mark overlay dirty for a specific spread index (if it's in the pool). */
  invalidateOverlayForSpread(spreadIndex: number): void;

  /** Mark ALL slots' overlays as dirty (e.g. after global search/annotation change). */
  invalidateAllOverlays(): void;

  /** Find which slot position (if any) holds a given spread index. */
  getSlotFor(spreadIndex: number): SlotPosition | null;
}

function createSlot(width: number, height: number): PageBufferSlot {
  return {
    spreadIndex: null,
    content: new OffscreenCanvas(width, height),
    overlay: null,
    contentDirty: true,
    overlayDirty: true,
  };
}

function resizeSlot(slot: PageBufferSlot, width: number, height: number): void {
  slot.content.width = width;
  slot.content.height = height;
  if (slot.overlay) {
    slot.overlay.width = width;
    slot.overlay.height = height;
  }
  slot.contentDirty = true;
  slot.overlayDirty = true;
}

function clearSlot(slot: PageBufferSlot): void {
  slot.spreadIndex = null;
  slot.contentDirty = true;
  slot.overlayDirty = true;
  if (slot.overlay) {
    const ctx = slot.overlay.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, slot.overlay.width, slot.overlay.height);
  }
}

interface PageBufferPoolState {
  readonly slots: [PageBufferSlot, PageBufferSlot, PageBufferSlot];
  indices: [number, number, number];
}

export function createPageBufferPool(): PageBufferPool {
  const state = createPoolState();
  const pool = createSlotAccessors(state) as PageBufferPool;
  Object.assign(
    pool,
    createRenderMethods(state),
    createRotationMethods(state),
    createInvalidationMethods(state),
  );
  return pool;
}

function createPoolState(): PageBufferPoolState {
  return {
    slots: [createSlot(1, 1), createSlot(1, 1), createSlot(1, 1)],
    indices: [0, 1, 2],
  };
}

function getSlot(state: PageBufferPoolState, pos: SlotPosition): PageBufferSlot {
  const idx = pos === 'prev' ? 0 : pos === 'curr' ? 1 : 2;
  const slot = state.slots[state.indices[idx]];
  if (!slot) throw new Error(`Invalid slot index for position ${pos}`);
  return slot;
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
      const w = Math.round(cssWidth * dpr);
      const h = Math.round(cssHeight * dpr);
      for (const slot of state.slots) resizeSlot(slot, w, h);
    },
    assignSlot(position, spreadIndex): void {
      assignSlot(state, position, spreadIndex);
    },
    ensureContent(position, renderer): void {
      ensureContent(state, position, renderer);
    },
    ensureOverlay(position, provider, backingRatio): void {
      ensureOverlay(state, position, provider, backingRatio);
    },
  };
}

function assignSlot(state: PageBufferPoolState, position: SlotPosition, spreadIndex: number): void {
  const slot = getSlot(state, position);
  slot.spreadIndex = spreadIndex;
  slot.contentDirty = true;
  slot.overlayDirty = true;
  clearOverlay(slot);
}

function ensureContent(
  state: PageBufferPoolState,
  position: SlotPosition,
  renderer: ContentRenderer,
): void {
  const slot = getSlot(state, position);
  if (!slot.contentDirty || slot.spreadIndex === null) return;
  const ctx = slot.content.getContext('2d');
  if (!ctx) return;
  renderer(slot.spreadIndex, ctx);
  slot.contentDirty = false;
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
  if (!slot.overlay) slot.overlay = new OffscreenCanvas(slot.content.width, slot.content.height);
  const ctx = slot.overlay.getContext('2d');
  if (!ctx) return;
  paintOverlayInto(ctx, layers, backingRatio);
  slot.overlayDirty = false;
}

function clearOverlay(slot: PageBufferSlot): void {
  if (!slot.overlay) return;
  const ctx = slot.overlay.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, slot.overlay.width, slot.overlay.height);
}

function createRotationMethods(
  state: PageBufferPoolState,
): Pick<PageBufferPool, 'rotateForward' | 'rotateBackward' | 'jump'> {
  return {
    rotateForward(): void {
      const oldPrev = state.indices[0];
      state.indices = [state.indices[1], state.indices[2], oldPrev] as [number, number, number];
      clearSlot(getSlot(state, 'next'));
    },
    rotateBackward(): void {
      const oldNext = state.indices[2];
      state.indices = [oldNext, state.indices[0], state.indices[1]] as [number, number, number];
      clearSlot(getSlot(state, 'prev'));
    },
    jump(spreadIndex): void {
      jumpToSpread(state, spreadIndex);
    },
  };
}

function jumpToSpread(state: PageBufferPoolState, spreadIndex: number): void {
  for (const slot of state.slots) clearSlot(slot);
  state.indices = [0, 1, 2];
  assignSlot(state, 'curr', spreadIndex);
}

function createInvalidationMethods(
  state: PageBufferPoolState,
): Pick<
  PageBufferPool,
  'invalidateAllContent' | 'invalidateOverlayForSpread' | 'invalidateAllOverlays' | 'getSlotFor'
> {
  return {
    invalidateAllContent(): void {
      for (const slot of state.slots) {
        slot.contentDirty = true;
        slot.overlayDirty = true;
      }
    },
    invalidateOverlayForSpread(spreadIndex): void {
      for (const slot of state.slots) {
        if (slot.spreadIndex === spreadIndex) slot.overlayDirty = true;
      }
    },
    invalidateAllOverlays(): void {
      for (const slot of state.slots) {
        if (slot.spreadIndex !== null) slot.overlayDirty = true;
      }
    },
    getSlotFor(spreadIndex): SlotPosition | null {
      if (getSlot(state, 'curr').spreadIndex === spreadIndex) return 'curr';
      if (getSlot(state, 'prev').spreadIndex === spreadIndex) return 'prev';
      if (getSlot(state, 'next').spreadIndex === spreadIndex) return 'next';
      return null;
    },
  };
}
