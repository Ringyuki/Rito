/**
 * Pure gesture state machine — no DOM, no side effects.
 * Tracks touch phases: idle → pending → locked (forward/backward).
 */

export type GestureDirection = 'forward' | 'backward';

export interface GestureState {
  phase: 'idle' | 'pending' | 'locked';
  direction: GestureDirection | null;
  startX: number;
  startY: number;
  currentDx: number;
  startTime: number;
}

export type GestureMoveResult =
  | { readonly kind: 'pending' }
  | { readonly kind: 'vertical-abort' }
  | { readonly kind: 'direction-locked'; readonly direction: GestureDirection; readonly dx: number }
  | { readonly kind: 'tracking'; readonly dx: number };

export type GestureEndResult =
  | { readonly kind: 'tap' }
  | { readonly kind: 'commit'; readonly direction: GestureDirection; readonly dx: number }
  | { readonly kind: 'cancel'; readonly direction: GestureDirection; readonly dx: number }
  | { readonly kind: 'no-op' };

const DIRECTION_LOCK_PX = 10;
const VELOCITY_COMMIT_THRESHOLD = 0.4; // px/ms

export function createGestureState(): GestureState {
  return { phase: 'idle', direction: null, startX: 0, startY: 0, currentDx: 0, startTime: 0 };
}

export function gestureStart(state: GestureState, x: number, y: number, time: number): void {
  state.phase = 'pending';
  state.direction = null;
  state.startX = x;
  state.startY = y;
  state.currentDx = 0;
  state.startTime = time;
}

export function gestureMove(state: GestureState, x: number, y: number): GestureMoveResult {
  if (state.phase === 'idle') return { kind: 'pending' };

  const dx = x - state.startX;
  const dy = y - state.startY;

  if (state.phase === 'pending') {
    // Vertical movement dominates — abort gesture
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < DIRECTION_LOCK_PX) {
      gestureReset(state);
      return { kind: 'vertical-abort' };
    }
    // Not enough horizontal movement yet
    if (Math.abs(dx) < DIRECTION_LOCK_PX) return { kind: 'pending' };
    // Lock direction
    state.phase = 'locked';
    state.direction = dx < 0 ? 'forward' : 'backward';
    state.currentDx = dx;
    return { kind: 'direction-locked', direction: state.direction, dx };
  }

  // locked phase — track movement
  state.currentDx = dx;
  return { kind: 'tracking', dx };
}

export function gestureEnd(state: GestureState, time: number, threshold: number): GestureEndResult {
  if (state.phase === 'idle') return { kind: 'no-op' };

  if (state.phase === 'pending') {
    // No direction was determined — treat as tap
    gestureReset(state);
    return { kind: 'tap' };
  }

  const dir = state.direction;
  const dx = state.currentDx;
  if (!dir) {
    gestureReset(state);
    return { kind: 'no-op' };
  }

  const elapsed = Math.max(1, time - state.startTime);
  const velocity = Math.abs(dx) / elapsed;
  const pastThreshold = Math.abs(dx) >= threshold;
  const fastSwipe = velocity >= VELOCITY_COMMIT_THRESHOLD;

  gestureReset(state);
  return pastThreshold || fastSwipe
    ? { kind: 'commit', direction: dir, dx }
    : { kind: 'cancel', direction: dir, dx };
}

export function gestureReset(state: GestureState): void {
  state.phase = 'idle';
  state.direction = null;
  state.currentDx = 0;
}
