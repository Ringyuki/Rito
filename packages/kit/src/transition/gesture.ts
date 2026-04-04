import type { TransitionOptions } from './types';

export interface GestureState {
  active: boolean;
  startX: number;
  startY: number;
  currentDx: number;
}

export function createGestureState(): GestureState {
  return { active: false, startX: 0, startY: 0, currentDx: 0 };
}

export function handleStart(state: GestureState, e: TouchEvent): void {
  const touch = e.touches[0];
  if (!touch) return;
  state.startX = touch.clientX;
  state.startY = touch.clientY;
  state.currentDx = 0;
  state.active = true;
}

export function handleMove(
  state: GestureState,
  e: TouchEvent,
  options: TransitionOptions,
): number | null {
  if (!state.active) return null;
  const touch = e.touches[0];
  if (!touch) return null;

  const dx = touch.clientX - state.startX;
  const dy = touch.clientY - state.startY;

  // If vertical movement dominates, cancel gesture
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dx) < 10) {
    state.active = false;
    return null;
  }

  state.currentDx = dx * options.elasticFactor + dx * (1 - options.elasticFactor);
  return state.currentDx;
}

export function handleEnd(
  state: GestureState,
  options: TransitionOptions,
): 'forward' | 'backward' | 'cancel' {
  if (!state.active) return 'cancel';
  state.active = false;

  if (Math.abs(state.currentDx) >= options.swipeThreshold) {
    return state.currentDx < 0 ? 'forward' : 'backward';
  }
  return 'cancel';
}
