import type { SlotPosition } from '../painter/types';
import type { TransitionEffect, TransitionEffectName } from './effects';

/** What the FrameDriver should draw each frame. */
export type DrawInstruction =
  | { readonly kind: 'single'; readonly slot: SlotPosition }
  | {
      readonly kind: 'turning';
      readonly outgoing: SlotPosition;
      readonly incoming: 'next' | 'prev' | null;
      readonly dx: number;
    };

/** Transition state machine modes. */
export type TransitionMode =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'tracking';
      readonly direction: 'forward' | 'backward';
      readonly outgoingSpread: number;
      readonly incomingSpread: number | null;
      dx: number;
      vx: number;
      lastSampleAt: number;
    }
  | {
      readonly kind: 'settling';
      readonly direction: 'forward' | 'backward';
      readonly outgoingSpread: number;
      readonly incomingSpread: number | null;
      readonly target: number;
      dx: number;
      vx: number;
    }
  | {
      readonly kind: 'boundary-elastic';
      readonly direction: 'forward' | 'backward';
      readonly slotSpread: number;
      dx: number;
      vx: number;
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
   * When the user asks the system for reduced motion, turns cross-fade
   * instead of moving (default true). Set false to keep `effect` as is.
   */
  readonly respectReducedMotion: boolean;
}

export const DEFAULT_TRANSITION_OPTIONS: TransitionDriverOptions = {
  stiffness: 180,
  damping: 22,
  velocityCommit: 0.4,
  swipeThreshold: 50,
  elasticFactor: 0.55,
  effect: 'slide',
  respectReducedMotion: true,
};
