import type { SlotPosition } from '../painter/types';

/** What the FrameDriver should draw each frame. */
export type DrawInstruction =
  | { readonly kind: 'single'; readonly slot: SlotPosition }
  | {
      readonly kind: 'turning';
      readonly outgoing: SlotPosition;
      readonly incoming: SlotPosition | null;
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
}

export const DEFAULT_TRANSITION_OPTIONS: TransitionDriverOptions = {
  stiffness: 180,
  damping: 22,
  velocityCommit: 0.4,
  swipeThreshold: 50,
  elasticFactor: 0.55,
};
