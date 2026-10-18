import type { DisplaySurface } from '../painter/display-surface';
import type { ContentRenderer, OverlayProvider, PageBufferPool } from '../painter/buffer-pool';
import type { SlotPosition } from '../painter/types';
import type { TransitionDriver } from './transition-driver';
import type { DrawInstruction } from './types';
import type { TransitionFrame } from './effects';
import { createTransitionScene, paintTransition, scaledTouch } from './transition-scene';

export interface FrameDriverDeps {
  readonly surface: DisplaySurface;
  readonly pool: PageBufferPool;
  readonly transitionDriver: TransitionDriver;
  readonly contentRenderer: ContentRenderer;
  readonly overlayProvider: OverlayProvider;
  readonly getBackingRatio: () => number;
  /** Called after each frame of a turn is painted. */
  readonly onTurnFrame?: ((frame: TransitionFrame) => void) | undefined;
}

/**
 * Single rAF composite loop. All visual output flows through here.
 *
 * Reads TransitionDriver state, ensures slot buffers are up to date,
 * and composites to the display surface. Stops the rAF loop when idle.
 */
export interface FrameDriver {
  /** Whether a turn, or what is left of one that was cut into, is being drawn frame by frame. */
  readonly animating: boolean;
  /** Calls back when what a cut turn had left comes to rest: no turn's end says the page is still. */
  onRest(cb: () => void): () => void;
  /** Request a composite on the next animation frame (idempotent). */
  scheduleComposite(): void;
  /** Composite immediately in the current task. Used for atomic layout commits. */
  compositeNow(): void;
  /** Hold the not-yet-painted first composite until the returned release is called. */
  holdFirstComposite(): (() => void) | null;
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
  firstCompositeStarted: boolean;
  firstCompositeHoldCount: number;
  heldCompositeRequest: 'none' | 'scheduled' | 'immediate';
}

export function createFrameDriver(deps: FrameDriverDeps): FrameDriver {
  const state: FrameDriverState = {
    rafId: null,
    lastFrameTime: 0,
    disposed: false,
    firstCompositeStarted: false,
    firstCompositeHoldCount: 0,
    heldCompositeRequest: 'none',
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
  state.firstCompositeStarted = true;
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
    get animating(): boolean {
      return deps.transitionDriver.isAnimating;
    },

    onRest(cb): () => void {
      return deps.transitionDriver.onRest(cb);
    },

    scheduleComposite(): void {
      scheduleComposite(state, onFrame);
    },

    compositeNow(): void {
      compositeNow(deps, state);
    },

    holdFirstComposite(): (() => void) | null {
      return holdFirstComposite(driver, state);
    },

    markOverlayDirty(spreadIndex): void {
      deps.pool.invalidateOverlayForSpread(spreadIndex);
      driver.scheduleComposite();
    },

    markContentDirty(spreadIndex): void {
      markContentDirty(deps, driver, spreadIndex);
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

function scheduleComposite(state: FrameDriverState, onFrame: FrameRequestCallback): void {
  if (state.disposed) return;
  if (state.firstCompositeHoldCount > 0) {
    requestHeldComposite(state, 'scheduled');
    return;
  }
  if (state.rafId !== null) return;
  state.rafId = requestAnimationFrame(onFrame);
}

function compositeNow(deps: FrameDriverDeps, state: FrameDriverState): void {
  if (state.disposed) return;
  if (state.firstCompositeHoldCount > 0) {
    requestHeldComposite(state, 'immediate');
    return;
  }
  cancelScheduledFrame(state);
  state.lastFrameTime = 0;
  state.firstCompositeStarted = true;
  compositeFrame(deps, deps.transitionDriver.step(16));
}

function holdFirstComposite(driver: FrameDriver, state: FrameDriverState): (() => void) | null {
  if (state.disposed || state.firstCompositeStarted) return null;
  state.firstCompositeHoldCount += 1;
  if (state.rafId !== null) {
    cancelScheduledFrame(state);
    requestHeldComposite(state, 'scheduled');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseFirstCompositeHold(driver, state);
  };
}

function markContentDirty(deps: FrameDriverDeps, driver: FrameDriver, spreadIndex: number): void {
  deps.pool.invalidateContentForSpread(spreadIndex);
  const slot = deps.pool.getSlotFor(spreadIndex);
  if (!slot) return;
  const ready = deps.pool.ensureContent(slot, deps.contentRenderer);
  if (slot !== 'curr' || !ready) return;
  if (deps.transitionDriver.isAnimating) driver.scheduleComposite();
  else driver.compositeNow();
}

function requestHeldComposite(
  state: FrameDriverState,
  request: Exclude<FrameDriverState['heldCompositeRequest'], 'none'>,
): void {
  if (request === 'immediate' || state.heldCompositeRequest === 'none') {
    state.heldCompositeRequest = request;
  }
}

function releaseFirstCompositeHold(driver: FrameDriver, state: FrameDriverState): void {
  state.firstCompositeHoldCount = Math.max(0, state.firstCompositeHoldCount - 1);
  if (state.firstCompositeHoldCount > 0 || state.disposed) return;
  const request = state.heldCompositeRequest;
  state.heldCompositeRequest = 'none';
  if (request === 'immediate') driver.compositeNow();
  else if (request === 'scheduled') driver.scheduleComposite();
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
  deps.pool.drawSlot(slotPosition, { x: 0, y: 0, width, height });
}

function drawTurningFrame(
  deps: FrameDriverDeps,
  instruction: Extract<DrawInstruction, { kind: 'turning' }>,
  width: number,
  height: number,
): void {
  // The outgoing page must be drawable before anything changes on screen.
  if (!ensureSlotReady(deps, 'curr')) return;
  const scale = width / (deps.transitionDriver.viewportWidth || width);
  const frame: TransitionFrame = {
    dx: instruction.dx * scale,
    width,
    incoming: instruction.incoming,
    phase: instruction.phase,
    velocity: instruction.velocity * scale,
    touch: instruction.touch && scaledTouch(instruction.touch, scale),
  };
  const ready = new Map<SlotPosition, boolean>();
  const source = {
    surface: deps.surface,
    pool: deps.pool,
    ready: (slot: SlotPosition): boolean => {
      let known = ready.get(slot);
      if (known === undefined) {
        known = ensureSlotReady(deps, slot);
        ready.set(slot, known);
      }
      return known;
    },
  };
  deps.surface.clear();
  paintTransition(
    createTransitionScene(source, width, height, scale, deps.transitionDriver.spine * scale),
    deps.transitionDriver.effect,
    frame,
    deps.surface,
  );
  deps.onTurnFrame?.(frame);
}
