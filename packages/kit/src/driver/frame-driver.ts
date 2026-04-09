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
  /** Mark a spread's overlay as needing re-render. */
  markOverlayDirty(spreadIndex: number): void;
  /** Mark ALL slots' overlays as needing re-render (global search/annotation change). */
  markAllOverlaysDirty(): void;
  /** Stop the rAF loop and clean up. */
  dispose(): void;
}

export function createFrameDriver(deps: FrameDriverDeps): FrameDriver {
  const {
    surface,
    pool,
    transitionDriver: td,
    contentRenderer,
    overlayProvider,
    getBackingRatio,
  } = deps;

  let rafId: number | null = null;
  let lastFrameTime = 0;
  let disposed = false;

  function ensureSlotReady(position: SlotPosition): void {
    pool.ensureContent(position, contentRenderer);
    pool.ensureOverlay(position, overlayProvider, getBackingRatio());
  }

  function compositeFrame(instruction: DrawInstruction): void {
    const W = surface.width;
    const H = surface.height;
    surface.clear();

    if (instruction.kind === 'single') {
      ensureSlotReady(instruction.slot);
      const slot = pool[instruction.slot];
      surface.ctx.drawImage(slot.content, 0, 0, W, H);
      if (slot.overlay) surface.ctx.drawImage(slot.overlay, 0, 0, W, H);
      return;
    }

    // Turning: draw outgoing + incoming at offset dx
    const { outgoing, incoming, dx } = instruction;

    ensureSlotReady(outgoing);
    const outSlot = pool[outgoing];

    // Scale dx from viewport-logical to backing-store pixels
    const ratio = W / (td.viewportWidth || W);
    const pxDx = Math.round(dx * ratio);

    surface.ctx.drawImage(outSlot.content, pxDx, 0, W, H);
    if (outSlot.overlay) surface.ctx.drawImage(outSlot.overlay, pxDx, 0, W, H);

    if (incoming) {
      ensureSlotReady(incoming);
      const inSlot = pool[incoming];
      // Use slot position to determine side: 'next' = right of outgoing, 'prev' = left.
      // Do NOT use dx sign — dx can cross zero when user reverses a gesture.
      const inX = pxDx + (incoming === 'next' ? W : -W);
      surface.ctx.drawImage(inSlot.content, inX, 0, W, H);
      if (inSlot.overlay) surface.ctx.drawImage(inSlot.overlay, inX, 0, W, H);
    }
  }

  function onFrame(now: number): void {
    rafId = null;
    if (disposed) return;

    const dt = lastFrameTime > 0 ? Math.min(now - lastFrameTime, 32) : 16;
    lastFrameTime = now;

    const instruction = td.step(dt);
    compositeFrame(instruction);

    if (td.isAnimating) {
      rafId = requestAnimationFrame(onFrame);
    } else {
      lastFrameTime = 0;
    }
  }

  const driver: FrameDriver = {
    scheduleComposite(): void {
      if (disposed) return;
      if (rafId !== null) return; // Already scheduled — idempotent
      rafId = requestAnimationFrame(onFrame);
    },

    markOverlayDirty(spreadIndex): void {
      pool.invalidateOverlayForSpread(spreadIndex);
      driver.scheduleComposite();
    },

    markAllOverlaysDirty(): void {
      pool.invalidateAllOverlays();
      driver.scheduleComposite();
    },

    dispose(): void {
      disposed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };

  return driver;
}
