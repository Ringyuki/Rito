import type { SlotPosition } from '../painter/types';
import {
  springPresets,
  type TransitionEffect,
  type TransitionEffectName,
  type TransitionPhase,
  type TransitionTouch,
} from './effects';
import type { TransitionPhysics, TransitionSettle } from './physics';

/** What the FrameDriver should draw each frame. */
export type DrawInstruction =
  | { readonly kind: 'single'; readonly slot: SlotPosition }
  | {
      readonly kind: 'turning';
      readonly outgoing: SlotPosition;
      readonly incoming: 'next' | 'prev' | null;
      readonly dx: number;
      readonly phase: TransitionPhase;
      /** How fast `dx` is changing, px/s; 0 while a finger holds the turn. */
      readonly velocity: number;
      readonly touch: TransitionTouch | null;
    };

/**
 * The neighbour a turn that was cut into left in the frame: the page it was
 * leaving or going back to, or `none` for a pull against the end of the
 * book, which shows no neighbour.
 */
export type LeavingNeighbour = 'next' | 'prev' | 'none';

/** Transition state machine modes. */
export type TransitionMode =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'tracking';
      readonly direction: 'forward' | 'backward';
      readonly outgoingSpread: number;
      readonly incomingSpread: number | null;
      dx: number;
      /** Finger velocity, px/ms. */
      vx: number;
      lastSampleAt: number;
      /** The finger holding the turn, when the gesture reports where it is. */
      touch: TransitionTouch | null;
      /** Where the turn was when the finger took it: what its travel is added to. */
      readonly from: number;
      /** What the turn this one began from left in the frame; null when it began at rest. */
      readonly leaving: LeavingNeighbour | null;
    }
  | {
      readonly kind: 'settling';
      readonly direction: 'forward' | 'backward';
      readonly outgoingSpread: number;
      readonly incomingSpread: number | null;
      readonly target: number;
      dx: number;
      /** Spring velocity, px/s. */
      vx: number;
      readonly touch: TransitionTouch | null;
      /** The physics' own way to rest; null for the built-in spring. */
      readonly settle: TransitionSettle | null;
      /** Seconds since `settle` began. */
      elapsed: number;
      readonly leaving: LeavingNeighbour | null;
    }
  | {
      readonly kind: 'boundary-elastic';
      readonly direction: 'forward' | 'backward';
      readonly slotSpread: number;
      dx: number;
      /** Spring velocity, px/s. */
      vx: number;
      readonly touch: TransitionTouch | null;
      readonly settle: TransitionSettle | null;
      elapsed: number;
      readonly leaving: LeavingNeighbour | null;
    }
  | {
      /**
       * What was left of a turn that another one cut into: its outcome is
       * settled and reported, and the picture goes the rest of the way to 0
       * in the coordinates that outcome left.
       */
      readonly kind: 'finishing';
      readonly leaving: LeavingNeighbour;
      dx: number;
      /** px/s. */
      vx: number;
      /** The motion the turn was already on, when its physics brought one. */
      readonly settle: TransitionSettle | null;
      elapsed: number;
      /** Added to what `settle` says: the turn's coordinates moved when it landed. */
      readonly shift: number;
    };

/** Callback when a transition settles (animation completes). */
export interface SettledEvent {
  readonly direction: 'forward' | 'backward';
  readonly committed: boolean;
  readonly targetSpread: number;
}

/** Options for transition behavior. */
export interface TransitionDriverOptions {
  readonly stiffness: number;
  readonly damping: number;
  /** Minimum velocity (px/ms) to commit a swipe even if dx < threshold. */
  readonly velocityCommit: number;
  /** Minimum displacement (px) to commit a swipe. */
  readonly swipeThreshold: number;
  /** Rubber band coefficient (0-1) for boundary overscroll. */
  readonly elasticFactor: number;
  /** How a turn looks: a built-in effect by name, or a custom one. */
  readonly effect: TransitionEffectName | TransitionEffect;
  /**
   * How a turn moves, in place of the built-in rules and of the physics an
   * effect brings. The numbers above feed the built-in rules only.
   */
  readonly physics?: TransitionPhysics | undefined;
  /**
   * When the user asks the system for reduced motion, turns cross-fade
   * instead of moving (default true). Set false to keep `effect` as is.
   */
  readonly respectReducedMotion: boolean;
}

export const DEFAULT_TRANSITION_OPTIONS: TransitionDriverOptions = {
  ...springPresets.default,
  velocityCommit: 0.4,
  swipeThreshold: 50,
  elasticFactor: 0.55,
  effect: 'slide',
  respectReducedMotion: true,
};
