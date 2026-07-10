import type { DisplaySurface } from '../painter/display-surface';
import type { ContentRenderer, OverlayProvider, PageBufferPool } from '../painter/buffer-pool';
import type { SlotPosition } from '../painter/types';
import type { TransitionDriver } from './transition-driver';
import type { DrawInstruction } from './types';

export interface FrameDriverDeps {
  readonly surface: DisplaySurface;
  readonly pool: PageBufferPool;
  readonly transitionDriver: TransitionDriver;
  readonly contentRenderer: ContentRenderer;
  readonly overlayProvider: OverlayProvider;
  readonly getBackingRatio: () => number;
}

/**
 * Single rAF composite loop. All visual output flows through here.
 *
 * Reads TransitionDriver state, ensures slot buffers are up to date,
 * and composites to the display surface. Stops the rAF loop when idle.
 */
export interface FrameDriver {
  /** Request a composite on the next animation frame (idempotent). */
  scheduleComposite(): void;
  /** Composite immediately in the current task. Used for atomic layout commits. */
  compositeNow(): void;
  /** Mark a spread's overlay as needing re-render. */
  markOverlayDirty(spreadIndex: number): void;
  /** Mark a spread's content and overlay as needing re-render. */
  markContentDirty(spreadIndex: number): void;
  /** Mark ALL slots' overlays as needing re-render (global search/annotation change). */
  markAllOverlaysDirty(): void;
  /** Stop the rAF loop and clean up. */
  dispose(): void;
}

interface FrameDriverState {
  rafId: number | null;
  lastFrameTime: number;
  disposed: boolean;
}

export function createFrameDriver(deps: FrameDriverDeps): FrameDriver {
  const state: FrameDriverState = {
    rafId: null,
    lastFrameTime: 0,
    disposed: false,
  };

  function onFrame(now: number): void {
    stepFrame(deps, state, onFrame, now);
  }

  return createFrameDriverApi(deps, state, onFrame);
}

function stepFrame(
  deps: FrameDriverDeps,
  state: FrameDriverState,
  onFrame: FrameRequestCallback,
  now: number,
): void {
  state.rafId = null;
  if (state.disposed) return;

  const dt = state.lastFrameTime > 0 ? Math.min(now - state.lastFrameTime, 32) : 16;
  state.lastFrameTime = now;
  compositeFrame(deps, deps.transitionDriver.step(dt));

  if (deps.transitionDriver.isAnimating) {
    state.rafId = requestAnimationFrame(onFrame);
  } else {
    state.lastFrameTime = 0;
  }
}

function createFrameDriverApi(
  deps: FrameDriverDeps,
  state: FrameDriverState,
  onFrame: FrameRequestCallback,
): FrameDriver {
  const driver: FrameDriver = {
    scheduleComposite(): void {
      if (state.disposed) return;
      if (state.rafId !== null) return; // Already scheduled — idempotent
      state.rafId = requestAnimationFrame(onFrame);
    },

    compositeNow(): void {
      if (state.disposed) return;
      cancelScheduledFrame(state);
      state.lastFrameTime = 0;
      compositeFrame(deps, deps.transitionDriver.step(16));
    },

    markOverlayDirty(spreadIndex): void {
      deps.pool.invalidateOverlayForSpread(spreadIndex);
      driver.scheduleComposite();
    },

    markContentDirty(spreadIndex): void {
      deps.pool.invalidateContentForSpread(spreadIndex);
      const slot = deps.pool.getSlotFor(spreadIndex);
      if (!slot) return;
      const ready = deps.pool.ensureContent(slot, deps.contentRenderer);
      if (slot !== 'curr' || !ready) return;
      if (deps.transitionDriver.isAnimating) driver.scheduleComposite();
      else driver.compositeNow();
    },

    markAllOverlaysDirty(): void {
      deps.pool.invalidateAllOverlays();
      driver.scheduleComposite();
    },

    dispose(): void {
      state.disposed = true;
      cancelScheduledFrame(state);
    },
  };

  return driver;
}

function cancelScheduledFrame(state: FrameDriverState): void {
  if (state.rafId === null) return;
  cancelAnimationFrame(state.rafId);
  state.rafId = null;
}

function ensureSlotReady(deps: FrameDriverDeps, position: SlotPosition): boolean {
  const contentReady = deps.pool.ensureContent(position, deps.contentRenderer);
  if (!contentReady) return false;
  deps.pool.ensureOverlay(position, deps.overlayProvider, deps.getBackingRatio());
  return true;
}

function compositeFrame(deps: FrameDriverDeps, instruction: DrawInstruction): void {
  const width = deps.surface.width;
  const height = deps.surface.height;

  if (instruction.kind === 'single') {
    drawSingleFrame(deps, instruction.slot, width, height);
    return;
  }
  drawTurningFrame(deps, instruction, width, height);
}

function drawSingleFrame(
  deps: FrameDriverDeps,
  slotPosition: SlotPosition,
  width: number,
  height: number,
): void {
  if (!ensureSlotReady(deps, slotPosition)) return;
  deps.surface.clear();
  const slot = deps.pool[slotPosition];
  deps.surface.ctx.drawImage(slot.content, 0, 0, width, height);
  if (slot.overlay) deps.surface.ctx.drawImage(slot.overlay, 0, 0, width, height);
}

function drawTurningFrame(
  deps: FrameDriverDeps,
  instruction: Extract<DrawInstruction, { kind: 'turning' }>,
  width: number,
  height: number,
): void {
  const { outgoing, incoming, dx } = instruction;
  if (!ensureSlotReady(deps, outgoing)) return;
  const pxDx = Math.round(dx * (width / (deps.transitionDriver.viewportWidth || width)));
  deps.surface.clear();
  drawContinuitySlot(deps, instruction, pxDx, width, height);
  drawSlotAt(deps, outgoing, pxDx, width, height);
  if (!incoming) return;
  const incomingX = pxDx + (incoming === 'next' ? width : -width);
  if (!ensureSlotReady(deps, incoming)) return;
  drawSlotAt(deps, incoming, incomingX, width, height);
}

function drawContinuitySlot(
  deps: FrameDriverDeps,
  instruction: Extract<DrawInstruction, { kind: 'turning' }>,
  pxDx: number,
  width: number,
  height: number,
): void {
  const carry = continuitySlot(instruction, pxDx, width);
  if (!carry) return;
  if (!ensureSlotReady(deps, carry.slot)) return;
  drawSlotAt(deps, carry.slot, carry.x, width, height);
}

function continuitySlot(
  instruction: Extract<DrawInstruction, { kind: 'turning' }>,
  pxDx: number,
  width: number,
): { readonly slot: SlotPosition; readonly x: number } | null {
  if (instruction.incoming === 'next' && pxDx > 0) {
    return { slot: 'prev', x: pxDx - width };
  }
  if (instruction.incoming === 'prev' && pxDx < 0) {
    return { slot: 'next', x: pxDx + width };
  }
  return null;
}

function drawSlotAt(
  deps: FrameDriverDeps,
  slotPosition: SlotPosition,
  x: number,
  width: number,
  height: number,
): void {
  const slot = deps.pool[slotPosition];
  deps.surface.ctx.drawImage(slot.content, x, 0, width, height);
  if (slot.overlay) deps.surface.ctx.drawImage(slot.overlay, x, 0, width, height);
}
