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
  let rafId: number | null = null;
  let lastFrameTime = 0;
  let disposed = false;

  function onFrame(now: number): void {
    rafId = null;
    if (disposed) return;

    const dt = lastFrameTime > 0 ? Math.min(now - lastFrameTime, 32) : 16;
    lastFrameTime = now;

    const instruction = deps.transitionDriver.step(dt);
    compositeFrame(deps, instruction);

    if (deps.transitionDriver.isAnimating) {
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
      deps.pool.invalidateOverlayForSpread(spreadIndex);
      driver.scheduleComposite();
    },

    markAllOverlaysDirty(): void {
      deps.pool.invalidateAllOverlays();
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

function ensureSlotReady(deps: FrameDriverDeps, position: SlotPosition): void {
  deps.pool.ensureContent(position, deps.contentRenderer);
  deps.pool.ensureOverlay(position, deps.overlayProvider, deps.getBackingRatio());
}

function compositeFrame(deps: FrameDriverDeps, instruction: DrawInstruction): void {
  const width = deps.surface.width;
  const height = deps.surface.height;
  deps.surface.clear();

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
  ensureSlotReady(deps, slotPosition);
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
  ensureSlotReady(deps, outgoing);
  const pxDx = Math.round(dx * (width / (deps.transitionDriver.viewportWidth || width)));
  drawSlotAt(deps, outgoing, pxDx, width, height);
  if (!incoming) return;
  const incomingX = pxDx + (incoming === 'next' ? width : -width);
  ensureSlotReady(deps, incoming);
  drawSlotAt(deps, incoming, incomingX, width, height);
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
