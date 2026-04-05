import type { SelectionEngine } from 'rito/selection';
import type { TransitionEngine } from '../../transition/types';
import type { InteractionModeManager } from '../interaction-mode/index';
import type { DisposableCollection } from '../../utils/disposable';

const LONG_PRESS_MS = 350;
const MOVE_SLOP_PX = 5;

type TouchPhase = 'idle' | 'waiting' | 'gesture' | 'long-press';

interface TouchState {
  phase: TouchPhase;
  timer: ReturnType<typeof setTimeout> | null;
  startTouch: { x: number; y: number } | null;
}

/**
 * Unified touch handler: routes touch events to either the transition engine
 * (swipe) or the selection engine (long-press), using a timer-based arbitrator.
 *
 * - Short touch + movement → gesture (page swipe via TransitionEngine)
 * - Long press (350ms) without movement → text selection via SelectionEngine
 * - Quick tap (no movement, fast release) → ignored (pointer events handle clicks)
 */
export function wireUnifiedTouchHandler(
  wrapper: HTMLElement,
  transition: TransitionEngine,
  selection: SelectionEngine,
  modeManager: InteractionModeManager,
  toContent: (touch: Touch) => { x: number; y: number },
  onTap: (pos: { x: number; y: number }) => void,
  disposables: DisposableCollection,
): void {
  const ts: TouchState = { phase: 'idle', timer: null, startTouch: null };

  const clearTimer = (): void => {
    if (ts.timer !== null) {
      clearTimeout(ts.timer);
      ts.timer = null;
    }
  };

  const onStart = (e: TouchEvent): void => {
    handleTouchStart(e, ts, transition, selection, modeManager, toContent);
  };
  const onMove = (e: TouchEvent): void => {
    handleTouchMove(e, ts, transition, selection, modeManager, toContent, clearTimer);
  };
  const onEnd = (e: TouchEvent): void => {
    handleTouchEnd(e, ts, transition, selection, toContent, onTap, clearTimer);
  };

  wrapper.addEventListener('touchstart', onStart, { passive: false });
  wrapper.addEventListener('touchmove', onMove, { passive: false });
  wrapper.addEventListener('touchend', onEnd);

  disposables.add(() => {
    clearTimer();
    wrapper.removeEventListener('touchstart', onStart);
    wrapper.removeEventListener('touchmove', onMove);
    wrapper.removeEventListener('touchend', onEnd);
  });
}

function handleTouchStart(
  e: TouchEvent,
  ts: TouchState,
  transition: TransitionEngine,
  selection: SelectionEngine,
  modeManager: InteractionModeManager,
  toContent: (touch: Touch) => { x: number; y: number },
): void {
  const touch = e.touches[0];
  if (!touch || transition.isAnimating) return;

  ts.startTouch = { x: touch.clientX, y: touch.clientY };
  ts.phase = 'waiting';

  ts.timer = setTimeout(() => {
    ts.timer = null;
    if (ts.phase !== 'waiting') return;
    ts.phase = 'long-press';
    modeManager.setMode('selection');
    selection.handlePointerDown(toContent(touch));
  }, LONG_PRESS_MS);
}

function handleTouchMove(
  e: TouchEvent,
  ts: TouchState,
  transition: TransitionEngine,
  selection: SelectionEngine,
  modeManager: InteractionModeManager,
  toContent: (touch: Touch) => { x: number; y: number },
  clearTimer: () => void,
): void {
  const touch = e.touches[0];
  if (!touch) return;

  if (ts.phase === 'waiting' && ts.startTouch) {
    const dx = touch.clientX - ts.startTouch.x;
    const dy = touch.clientY - ts.startTouch.y;
    if (Math.abs(dx) > MOVE_SLOP_PX || Math.abs(dy) > MOVE_SLOP_PX) {
      clearTimer();
      ts.phase = 'gesture';
      modeManager.setMode('gesture');
      transition.handleTouchStart(e);
    }
    return;
  }

  if (ts.phase === 'gesture') {
    if (e.cancelable) e.preventDefault();
    transition.handleTouchMove(e);
    return;
  }

  if (ts.phase === 'long-press') {
    selection.handlePointerMove(toContent(touch));
  }
}

function handleTouchEnd(
  e: TouchEvent,
  ts: TouchState,
  transition: TransitionEngine,
  selection: SelectionEngine,
  toContent: (touch: Touch) => { x: number; y: number },
  onTap: (pos: { x: number; y: number }) => void,
  clearTimer: () => void,
): void {
  const currentPhase = ts.phase;
  clearTimer();

  if (currentPhase === 'gesture') {
    transition.handleTouchEnd(e);
  } else if (currentPhase === 'long-press') {
    const touch = e.changedTouches[0];
    if (touch) {
      selection.handlePointerUp(toContent(touch));
    }
  } else if (currentPhase === 'waiting') {
    // Quick tap — clear selection + trigger tap action (annotation/link clicks)
    selection.clear();
    const touch = e.changedTouches[0];
    if (touch) {
      onTap(toContent(touch));
    }
  }

  ts.phase = 'idle';
  ts.startTouch = null;
}
