import {
  cancelTrackingMode,
  goToTargetMode,
  interruptMode,
  releaseTrackingMode,
  startTrackingMode,
  updateTrackingMode,
} from './transition-actions';
import type { TransitionDriverState } from './transition-state';
import {
  getSlotPositions,
  stepSettling,
  stepBoundaryElastic,
  forceSettleMode,
} from './transition-steps';
import type {
  DrawInstruction,
  SettledEvent,
  TransitionDriverOptions,
  TransitionMode,
} from './types';
import { DEFAULT_TRANSITION_OPTIONS } from './types';

/**
 * Pure JS transition state machine with spring physics.
 * Does NOT import any DOM types — entirely testable in Node.
 */
export interface TransitionDriver {
  /** Current mode. */
  readonly mode: TransitionMode;
  /** Whether any animation is in progress. */
  readonly isAnimating: boolean;
  /** The viewport width used for displacement calculations. */
  viewportWidth: number;

  /** Begin gesture tracking after direction lock. */
  startTracking(
    direction: 'forward' | 'backward',
    outgoingSpread: number,
    incomingSpread: number | null,
    timestamp: number,
  ): void;

  /** Update tracking position during gesture. */
  updateTracking(rawDx: number, timestamp: number): void;

  /**
   * Release tracking (touchend). Returns whether the transition commits or cancels.
   * Transitions to 'settling' or 'boundary-elastic'.
   */
  releaseTracking(): 'commit' | 'cancel';

  /** Cancel an owned drag/settle and settle back to its outgoing spread. */
  cancelTracking(): boolean;

  /** Programmatic navigation (keyboard, TOC). Goes directly to settling. */
  goToTarget(
    direction: 'forward' | 'backward',
    outgoingSpread: number,
    incomingSpread: number | null,
    initialDx?: number,
  ): void;

  /** Interrupt a settling animation to resume tracking. Preserves dx/vx. */
  interrupt(timestamp: number): { dx: number; vx: number } | null;

  /** Advance one frame. Returns what to draw. `dt` is in milliseconds. */
  step(dt: number): DrawInstruction;

  /**
   * Instantly complete the current animation: snap dx to target, trigger onSettled.
   * Returns the residual dx at the moment of force-settle (for visual continuity).
   */
  forceSettle(): number;

  /** Update spring/swipe parameters at runtime. */
  configure(update: Partial<TransitionDriverOptions>): void;

  /** Force back to idle without triggering onSettled. */
  reset(): void;

  /** Register callback for when settling completes. */
  onSettled(cb: (event: SettledEvent) => void): () => void;
}

export function createTransitionDriver(
  options?: Partial<TransitionDriverOptions>,
): TransitionDriver {
  const state: TransitionDriverState = {
    opts: { ...DEFAULT_TRANSITION_OPTIONS, ...options },
    mode: { kind: 'idle' },
    viewportWidth: 0,
    velocitySamples: [],
    settledListeners: new Set<(event: SettledEvent) => void>(),
  };
  const driver = createDriverAccessors(state) as TransitionDriver;
  Object.assign(
    driver,
    createTrackingActions(state),
    createAnimationActions(state),
    createConfigurationActions(state),
  );
  return driver;
}

function createDriverAccessors(
  state: TransitionDriverState,
): Pick<TransitionDriver, 'mode' | 'isAnimating' | 'viewportWidth'> {
  return {
    get mode() {
      return state.mode;
    },
    get isAnimating() {
      return state.mode.kind !== 'idle';
    },
    get viewportWidth() {
      return state.viewportWidth;
    },
    set viewportWidth(w: number) {
      state.viewportWidth = w;
    },
  };
}

function createTrackingActions(
  state: TransitionDriverState,
): Pick<
  TransitionDriver,
  | 'startTracking'
  | 'updateTracking'
  | 'releaseTracking'
  | 'cancelTracking'
  | 'goToTarget'
  | 'interrupt'
> {
  return {
    startTracking(direction, outgoingSpread, incomingSpread, timestamp): void {
      startTrackingMode(state, direction, outgoingSpread, incomingSpread, timestamp);
    },
    updateTracking(rawDx, timestamp): void {
      updateTrackingMode(state, rawDx, timestamp);
    },
    releaseTracking(): 'commit' | 'cancel' {
      return releaseTrackingMode(state);
    },
    cancelTracking(): boolean {
      return cancelTrackingMode(state);
    },
    goToTarget(direction, outgoingSpread, incomingSpread, initialDx = 0): void {
      goToTargetMode(state, direction, outgoingSpread, incomingSpread, initialDx);
    },
    interrupt(timestamp): { dx: number; vx: number } | null {
      return interruptMode(state, timestamp);
    },
  };
}

function createAnimationActions(
  state: TransitionDriverState,
): Pick<TransitionDriver, 'step' | 'forceSettle'> {
  return {
    step(dt): DrawInstruction {
      return stepTransition(state, dt);
    },
    forceSettle(): number {
      return forceSettle(state);
    },
  };
}

function createConfigurationActions(
  state: TransitionDriverState,
): Pick<TransitionDriver, 'configure' | 'reset' | 'onSettled'> {
  return {
    configure(update): void {
      state.opts = { ...state.opts, ...update };
    },
    reset(): void {
      state.mode = { kind: 'idle' };
    },
    onSettled(cb): () => void {
      state.settledListeners.add(cb);
      return () => state.settledListeners.delete(cb);
    },
  };
}

function stepTransition(state: TransitionDriverState, dt: number): DrawInstruction {
  switch (state.mode.kind) {
    case 'idle':
      return { kind: 'single', slot: 'curr' };
    case 'tracking':
      return { kind: 'turning', ...getSlotPositions(state.mode), dx: state.mode.dx };
    case 'settling':
      return applyStepResult(state, stepSettling(state.mode, state.opts, dt));
    case 'boundary-elastic':
      return applyStepResult(state, stepBoundaryElastic(state.mode, state.opts, dt));
  }
}

function applyStepResult(
  state: TransitionDriverState,
  result: ReturnType<typeof stepSettling> | ReturnType<typeof stepBoundaryElastic>,
): DrawInstruction {
  state.mode = result.nextMode;
  if (result.settled) emitSettled(state, result.settled);
  return result.instruction;
}

function forceSettle(state: TransitionDriverState): number {
  const result = forceSettleMode(state.mode);
  state.mode = { kind: 'idle' };
  if (result.settled) emitSettled(state, result.settled);
  return result.residualDx;
}

function emitSettled(state: TransitionDriverState, event: SettledEvent): void {
  for (const cb of state.settledListeners) cb(event);
}
