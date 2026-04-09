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

export function createPageBufferPool(): PageBufferPool {
  // Start with 1×1 — resize() must be called before use
  const slots: [PageBufferSlot, PageBufferSlot, PageBufferSlot] = [
    createSlot(1, 1),
    createSlot(1, 1),
    createSlot(1, 1),
  ];

  // Indices into the slots array: [prev, curr, next]
  let indices: [number, number, number] = [0, 1, 2];

  const getSlot = (pos: SlotPosition): PageBufferSlot => {
    const idx = pos === 'prev' ? 0 : pos === 'curr' ? 1 : 2;
    const slot = slots[indices[idx]];
    if (!slot) throw new Error(`Invalid slot index for position ${pos}`);
    return slot;
  };

  const pool: PageBufferPool = {
    get prev() {
      return getSlot('prev');
    },
    get curr() {
      return getSlot('curr');
    },
    get next() {
      return getSlot('next');
    },

    resize(cssWidth, cssHeight, dpr): void {
      const w = Math.round(cssWidth * dpr);
      const h = Math.round(cssHeight * dpr);
      for (const slot of slots) {
        resizeSlot(slot, w, h);
      }
    },

    assignSlot(position, spreadIndex): void {
      const slot = getSlot(position);
      slot.spreadIndex = spreadIndex;
      slot.contentDirty = true;
      slot.overlayDirty = true;
      // Clear old overlay pixels
      if (slot.overlay) {
        const ctx = slot.overlay.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, slot.overlay.width, slot.overlay.height);
      }
    },

    ensureContent(position, renderer): void {
      const slot = getSlot(position);
      if (!slot.contentDirty || slot.spreadIndex === null) return;
      const ctx = slot.content.getContext('2d');
      if (!ctx) return;
      renderer(slot.spreadIndex, ctx);
      slot.contentDirty = false;
    },

    ensureOverlay(position, provider, backingRatio): void {
      const slot = getSlot(position);
      if (!slot.overlayDirty || slot.spreadIndex === null) return;
      const layers = provider(slot.spreadIndex);
      if (layers.length === 0) {
        // No layers — clear overlay if it exists, skip allocation
        if (slot.overlay) {
          const ctx = slot.overlay.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, slot.overlay.width, slot.overlay.height);
        }
        slot.overlayDirty = false;
        return;
      }
      // Lazy allocate overlay buffer
      if (!slot.overlay) {
        slot.overlay = new OffscreenCanvas(slot.content.width, slot.content.height);
      }
      const ctx = slot.overlay.getContext('2d');
      if (!ctx) return;
      paintOverlayInto(ctx, layers, backingRatio);
      slot.overlayDirty = false;
    },

    rotateForward(): void {
      // prev ← curr, curr ← next, next ← old prev (cleared)
      const oldPrev = indices[0];
      indices = [indices[1], indices[2], oldPrev] as [number, number, number];
      clearSlot(getSlot('next'));
    },

    rotateBackward(): void {
      // next ← curr, curr ← prev, prev ← old next (cleared)
      const oldNext = indices[2];
      indices = [oldNext, indices[0], indices[1]] as [number, number, number];
      clearSlot(getSlot('prev'));
    },

    jump(spreadIndex): void {
      for (const slot of slots) {
        clearSlot(slot);
      }
      indices = [0, 1, 2];
      getSlot('curr').spreadIndex = spreadIndex;
      getSlot('curr').contentDirty = true;
      getSlot('curr').overlayDirty = true;
    },

    invalidateAllContent(): void {
      for (const slot of slots) {
        slot.contentDirty = true;
        slot.overlayDirty = true;
      }
    },

    invalidateOverlayForSpread(spreadIndex): void {
      for (const slot of slots) {
        if (slot.spreadIndex === spreadIndex) {
          slot.overlayDirty = true;
        }
      }
    },

    invalidateAllOverlays(): void {
      for (const slot of slots) {
        if (slot.spreadIndex !== null) {
          slot.overlayDirty = true;
        }
      }
    },

    getSlotFor(spreadIndex): SlotPosition | null {
      if (getSlot('curr').spreadIndex === spreadIndex) return 'curr';
      if (getSlot('prev').spreadIndex === spreadIndex) return 'prev';
      if (getSlot('next').spreadIndex === spreadIndex) return 'next';
      return null;
    },
  };

  return pool;
}
