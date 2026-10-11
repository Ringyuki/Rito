import {
  cancelTrackingMode,
  goToTargetMode,
  interruptMode,
  releaseTrackingMode,
  startTrackingMode,
  updateTrackingMode,
} from './transition-actions';
import { handOverMode } from './transition-hand-over';
import { activeEffect, activePhysics, type TransitionDriverState } from './transition-state';
import {
  turningInstruction,
  stepSettling,
  stepBoundaryElastic,
  stepFinishing,
  forceSettleMode,
} from './transition-steps';
import type {
  DrawInstruction,
  SettledEvent,
  TransitionDriverOptions,
  TransitionMode,
} from './types';
import { DEFAULT_TRANSITION_OPTIONS } from './types';
import type { TransitionEffect, TransitionTouch } from './effects';
import type { TransitionPhysics } from './physics';

/**
 * Pure JS transition state machine with spring physics.
 * Does NOT import any DOM types — entirely testable in Node.
 */
export interface TransitionDriver {
  /** Current mode. */
  readonly mode: TransitionMode;
  /** Whether anything is moving: a turn, or what is left of one that was cut into. */
  readonly isAnimating: boolean;
  /** Whether a turn is open: held, landing, going back, or pulling against the end of the book. */
  readonly turning: boolean;
  /** The viewport width used for displacement calculations. */
  viewportWidth: number;
  /** Where the pages are bound, as an x in the viewport: 0, or the middle of a two-page spread. */
  spine: number;
  /**
   * How turns look: the configured effect, or a cross-fade while the
   * system asks for reduced motion (unless `respectReducedMotion` is off).
   */
  readonly effect: TransitionEffect;
  /** How turns move when not by the built-in rules: the options' physics, else the effect's. */
  readonly physics: TransitionPhysics | undefined;
  /** Whether the system asks for reduced motion. */
  reducedMotion: boolean;

  /** Begin gesture tracking after direction lock. */
  startTracking(
    direction: 'forward' | 'backward',
    outgoingSpread: number,
    incomingSpread: number | null,
    timestamp: number,
  ): void;

  /** Update tracking position during gesture; `touch` says where the finger is. */
  updateTracking(rawDx: number, timestamp: number, touch?: TransitionTouch): void;

  /**
   * Release tracking (touchend). Returns whether the transition commits or cancels.
   * Transitions to 'settling' or 'boundary-elastic'.
   */
  releaseTracking(): 'commit' | 'cancel';

  /** Cancel an owned drag/settle and settle back to its outgoing spread. */
  cancelTracking(): boolean;

  /** Programmatic navigation (keyboard, TOC): settling from rest, or from what a cut turn left. */
  goToTarget(
    direction: 'forward' | 'backward',
    outgoingSpread: number,
    incomingSpread: number | null,
  ): void;

  /** Interrupt a settling animation to resume tracking; the finger's travel adds to where it is. */
  interrupt(timestamp: number): { dx: number; vx: number } | null;

  /**
   * Cut into the open turn for another to begin: its outcome is settled and
   * reported at once, as `forceSettle` would, and its picture carries on
   * until the next turn takes it up or it comes to rest.
   */
  handOver(): void;

  /** Advance one frame. Returns what to draw. `dt` is in milliseconds. */
  step(dt: number): DrawInstruction;

  /**
   * Instantly complete the current animation: snap dx to target, trigger
   * onSettled, stop what a cut turn had left. For what cannot carry on (a
   * jump, a relayout, a selection). Returns the dx it stopped at.
   */
  forceSettle(): number;

  /** Update spring/swipe parameters at runtime. */
  configure(update: Partial<TransitionDriverOptions>): void;

  /** Force back to idle without triggering onSettled. */
  reset(): void;

  /** Register callback for when settling completes. */
  onSettled(cb: (event: SettledEvent) => void): () => void;

  /** Register callback for when what a cut turn had left comes to rest, taken up by no turn. */
  onRest(cb: () => void): () => void;
}

export function createTransitionDriver(
  options?: Partial<TransitionDriverOptions>,
): TransitionDriver {
  const state: TransitionDriverState = {
    opts: { ...DEFAULT_TRANSITION_OPTIONS, ...options },
    mode: { kind: 'idle' },
    viewportWidth: 0,
    reducedMotion: false,
    spine: 0,
    velocitySamples: [],
    settledListeners: new Set<(event: SettledEvent) => void>(),
    restListeners: new Set<() => void>(),
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
): Pick<
  TransitionDriver,
  | 'mode'
  | 'isAnimating'
  | 'turning'
  | 'viewportWidth'
  | 'spine'
  | 'effect'
  | 'physics'
  | 'reducedMotion'
> {
  return {
    get effect() {
      return activeEffect(state);
    },
    get physics() {
      return activePhysics(state);
    },
    get spine() {
      return state.spine;
    },
    set spine(x: number) {
      state.spine = x;
    },
    get reducedMotion() {
      return state.reducedMotion;
    },
    set reducedMotion(value: boolean) {
      state.reducedMotion = value;
    },
    get mode() {
      return state.mode;
    },
    get isAnimating() {
      return state.mode.kind !== 'idle';
    },
    get turning() {
      return state.mode.kind !== 'idle' && state.mode.kind !== 'finishing';
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
  | 'handOver'
> {
  return {
    startTracking(direction, outgoingSpread, incomingSpread, timestamp): void {
      startTrackingMode(state, direction, outgoingSpread, incomingSpread, timestamp);
    },
    updateTracking(rawDx, timestamp, touch): void {
      updateTrackingMode(state, rawDx, timestamp, touch);
    },
    releaseTracking(): 'commit' | 'cancel' {
      return releaseTrackingMode(state);
    },
    cancelTracking(): boolean {
      return cancelTrackingMode(state);
    },
    goToTarget(direction, outgoingSpread, incomingSpread): void {
      goToTargetMode(state, direction, outgoingSpread, incomingSpread);
    },
    interrupt(timestamp): { dx: number; vx: number } | null {
      return interruptMode(state, timestamp);
    },
    handOver(): void {
      const settled = handOverMode(state);
      if (settled) emitSettled(state, settled);
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
): Pick<TransitionDriver, 'configure' | 'reset' | 'onSettled' | 'onRest'> {
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
    onRest(cb): () => void {
      state.restListeners.add(cb);
      return () => state.restListeners.delete(cb);
    },
  };
}

function stepTransition(state: TransitionDriverState, dt: number): DrawInstruction {
  switch (state.mode.kind) {
    case 'idle':
      return { kind: 'single', slot: 'curr' };
    case 'tracking':
      return turningInstruction(state.mode);
    case 'settling':
      return applyStepResult(
        state,
        stepSettling(state.mode, state.opts, dt, activeEffect(state).instant),
      );
    case 'boundary-elastic':
      return applyStepResult(state, stepBoundaryElastic(state.mode, state.opts, dt));
    case 'finishing': {
      const result = stepFinishing(state.mode, state.opts, dt);
      state.mode = result.nextMode;
      if (result.nextMode.kind === 'idle') for (const cb of state.restListeners) cb();
      return result.instruction;
    }
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
