import type { ReaderGlTarget } from '@ritojs/core';
import {
  createPageBufferPoolState,
  disposePageBufferPoolState,
  resizeBufferSlot,
  type PageBufferPoolState,
} from './buffer-pool-state';
import { createInvalidationMethods } from './buffer-pool-invalidation';
import {
  clearOverlay,
  ensureOverlay,
  hostLayer,
  layHost,
  pageTexture,
  type PageTexture,
} from './buffer-pool-layers';
import type { GlCompositor, QuadRect } from './gl/compositor';
import { createPageTarget } from './gl/targets';
import type { OverlayLayer, PageBufferSlot, SlotPosition } from './types';

/** Provider function that produces overlay layers for a given spread index. */
export type OverlayProvider = (spreadIndex: number) => readonly OverlayLayer[];

/** Where a content renderer paints a spread. */
export interface PageTarget {
  /** The framebuffer `reader.renderSpreadTo` paints the spread into. */
  readonly target: ReaderGlTarget;
  /** A cleared canvas over the page for a host's painter: what is drawn on it lands on the page. */
  hostLayer(): OffscreenCanvasRenderingContext2D;
}

/** Paints a spread into a page target; false while it cannot yet. */
export type ContentRenderer = (spreadIndex: number, page: PageTarget) => boolean;

export type { PageTexture } from './buffer-pool-layers';

/** Three-slot ring buffer: the spread on screen and the one a turn leads to on either side. */
export interface PageBufferPool {
  readonly prev: PageBufferSlot;
  readonly curr: PageBufferSlot;
  readonly next: PageBufferSlot;

  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  assignSlot(position: SlotPosition, spreadIndex: number): void;
  ensureContent(position: SlotPosition, renderer: ContentRenderer): boolean;

  ensureOverlay(position: SlotPosition, provider: OverlayProvider, backingRatio: number): void;
  /** Draws a slot's page, its overlay over it, over `rect` of what is bound. */
  drawSlot(position: SlotPosition, rect: QuadRect, opacity?: number): void;
  /**
   * A slot's page as one texture, its overlay over it: the same texture
   * from version to version until the buffers are resized. It binds a
   * framebuffer of its own to make it.
   */
  pageTexture(position: SlotPosition): PageTexture;
  rotateForward(): void;
  rotateBackward(): void;
  jump(spreadIndex: number): void;
  invalidateAllContent(): void;
  invalidateContentForSpread(spreadIndex: number): void;
  invalidateOverlayForSpread(spreadIndex: number): void;
  invalidateAllOverlays(): void;
  getSlotFor(spreadIndex: number): SlotPosition | null;
  /** Makes every buffer again, empty, in a context restored after it was lost. */
  restore(): void;
  dispose(): void;
}

export function createPageBufferPool(compositor: GlCompositor): PageBufferPool {
  const state = createPageBufferPoolState(compositor.gl);
  try {
    const pool = createSlotAccessors(state) as PageBufferPool;
    Object.assign(
      pool,
      createRenderMethods(state, compositor),
      createRotationMethods(state),
      createInvalidationMethods(state, { getSlot }),
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
  compositor: GlCompositor,
): Pick<
  PageBufferPool,
  | 'resize'
  | 'assignSlot'
  | 'ensureContent'
  | 'ensureOverlay'
  | 'drawSlot'
  | 'pageTexture'
  | 'restore'
> {
  return {
    restore(): void {
      if (state.disposed) return;
      restoreSlots(state);
    },
    resize(cssWidth, cssHeight, dpr): void {
      if (state.disposed) return;
      resizeSlots(state, Math.round(cssWidth * dpr), Math.round(cssHeight * dpr));
    },
    assignSlot(position, spreadIndex): void {
      if (state.disposed) return;
      assignSlot(state, position, spreadIndex);
    },
    ensureContent(position, renderer): boolean {
      if (state.disposed) return false;
      return ensureContent(state, compositor, position, renderer);
    },
    ensureOverlay(position, provider, backingRatio): void {
      if (state.disposed) return;
      ensureOverlay(state, getSlot(state, position), provider, backingRatio);
    },
    drawSlot(position, rect, opacity = 1): void {
      drawSlot(compositor, getSlot(state, position), rect, opacity);
    },
    pageTexture(position): PageTexture {
      return pageTexture(state, compositor, getSlot(state, position));
    },
  };
}

function resizeSlots(state: PageBufferPoolState, width: number, height: number): void {
  if (state.width === width && state.height === height) return;
  state.width = width;
  state.height = height;
  for (const slot of state.slots) resizeBufferSlot(state.gl, slot, width, height);
}

function drawSlot(
  compositor: GlCompositor,
  slot: PageBufferSlot,
  rect: QuadRect,
  opacity: number,
): void {
  compositor.drawTexture(slot.content.texture, rect, opacity);
  if (slot.overlay && slot.overlayShown) {
    compositor.drawTexture(slot.overlay.texture, rect, opacity);
  }
}

/** What a lost context held is gone: every slot gets new, empty buffers and is painted again. */
function restoreSlots(state: PageBufferPoolState): void {
  state.host = null;
  for (const slot of state.slots) {
    slot.content = createPageTarget(state.gl, state.width, state.height);
    slot.overlay = null;
    slot.composed = null;
    slot.composedAt = -1;
    slot.overlayShown = false;
    slot.contentDirty = true;
    slot.overlayDirty = true;
    slot.paints += 1;
  }
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
  compositor: GlCompositor,
  position: SlotPosition,
  renderer: ContentRenderer,
): boolean {
  const slot = getSlot(state, position);
  if (slot.spreadIndex === null) return false;
  if (!slot.contentDirty) return true;
  const { content } = slot;
  const drawnOver = { host: null as OffscreenCanvasRenderingContext2D | null };
  const page: PageTarget = {
    target: {
      gl: state.gl,
      framebuffer: content.framebuffer,
      width: content.width,
      height: content.height,
    },
    hostLayer: () => (drawnOver.host ??= hostLayer(state, content.width, content.height)),
  };
  if (!renderer(slot.spreadIndex, page)) return false;
  // What the host drew lands on the page, under the overlay.
  if (drawnOver.host) layHost(state, compositor, slot);
  slot.contentDirty = false;
  slot.composedAt = -1;
  slot.paints += 1;
  return true;
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
  for (const slot of state.slots) clearSlot(slot);
  state.indices = [0, 1, 2];
  assignSlot(state, 'curr', spreadIndex);
}
