import type { SelectionEngine } from '@ritojs/core/selection';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { FrameDriver } from '../../driver/frame-driver';
import type { InteractionModeManager } from '../interaction-mode/index';
import type { DisposableCollection } from '../../utils/disposable';

const LONG_PRESS_MS = 350;
const MOVE_SLOP_PX = 5;

type TouchPhase = 'idle' | 'waiting' | 'gesture' | 'long-press';

interface TouchState {
  phase: TouchPhase;
  timer: ReturnType<typeof setTimeout> | null;
  startTouch: { x: number; y: number } | null;
  /** Whether td was animating when this touch started. */
  wasAnimating: boolean;
}

interface TouchHandlerContext {
  readonly state: TouchState;
  readonly deps: GestureDeps;
  readonly selection: SelectionEngine;
  readonly modeManager: InteractionModeManager;
  readonly toContent: (touch: Touch) => { x: number; y: number };
  readonly onTap: (pos: { x: number; y: number }) => void;
}

export interface GestureDeps {
  readonly td: TransitionDriver;
  readonly frameDriver: FrameDriver;
  readonly goToSpread: (index: number) => void;
  readonly getCurrentSpread: () => number;
  readonly getTotalSpreads: () => number;
  /**
   * Force-complete the current transition (forceSettle).
   * Used for same-direction rapid flipping where we want to commit
   * the current animation and immediately start a new one.
   */
  readonly commitPendingTransition: () => void;
}

/**
 * Unified touch handler: routes touch events to either page swipe
 * or text selection (long-press).
 *
 * Direction lock in onMove decides how to handle an in-progress transition:
 * - Same direction as current animation → commit + start new navigation (rapid flip)
 * - Opposite direction → interrupt and track from current position (reversal/cancel)
 */
export function wireUnifiedTouchHandler(
  target: HTMLElement,
  gestureDeps: GestureDeps,
  selection: SelectionEngine,
  modeManager: InteractionModeManager,
  toContent: (touch: Touch) => { x: number; y: number },
  onTap: (pos: { x: number; y: number }) => void,
  disposables: DisposableCollection,
): void {
  const context: TouchHandlerContext = {
    state: { phase: 'idle', timer: null, startTouch: null, wasAnimating: false },
    deps: gestureDeps,
    selection,
    modeManager,
    toContent,
    onTap,
  };
  const onStart = (event: TouchEvent): void => {
    handleTouchStart(context, event);
  };
  const onMove = (event: TouchEvent): void => {
    handleTouchMove(context, event);
  };
  const onEnd = (event: TouchEvent): void => {
    handleTouchEnd(context, event);
  };

  target.addEventListener('touchstart', onStart, { passive: false });
  target.addEventListener('touchmove', onMove, { passive: false });
  target.addEventListener('touchend', onEnd);

  disposables.add(() => {
    clearTimer(context.state);
    target.removeEventListener('touchstart', onStart);
    target.removeEventListener('touchmove', onMove);
    target.removeEventListener('touchend', onEnd);
  });
}

function handleTouchStart(context: TouchHandlerContext, event: TouchEvent): void {
  const touch = event.touches[0];
  if (!touch) return;
  const { state, deps } = context;
  state.startTouch = { x: touch.clientX, y: touch.clientY };
  state.wasAnimating = deps.td.isAnimating;
  state.phase = 'waiting';
  if (!deps.td.isAnimating) scheduleLongPress(context, touch);
}

function scheduleLongPress(context: TouchHandlerContext, touch: Touch): void {
  const { state, modeManager, selection, toContent } = context;
  state.timer = setTimeout(() => {
    state.timer = null;
    if (state.phase !== 'waiting') return;
    state.phase = 'long-press';
    modeManager.setMode('selection');
    selection.handlePointerDown(toContent(touch));
  }, LONG_PRESS_MS);
}

function handleTouchMove(context: TouchHandlerContext, event: TouchEvent): void {
  const touch = event.touches[0];
  if (!touch) return;
  if (context.state.phase === 'waiting' && context.state.startTouch) {
    handleWaitingMove(context, event, touch);
  } else if (context.state.phase === 'gesture') {
    handleGestureMove(context, event, touch);
  } else if (context.state.phase === 'long-press') {
    context.selection.handlePointerMove(context.toContent(touch));
  }
}

function handleWaitingMove(context: TouchHandlerContext, event: TouchEvent, touch: Touch): void {
  const start = context.state.startTouch;
  if (!start) return;
  const dx = touch.clientX - start.x;
  const dy = touch.clientY - start.y;
  if (Math.abs(dx) <= MOVE_SLOP_PX && Math.abs(dy) <= MOVE_SLOP_PX) return;
  beginGesture(context, dx, event.timeStamp);
}

function beginGesture(context: TouchHandlerContext, dx: number, timestamp: number): void {
  const { state, deps, modeManager } = context;
  clearTimer(state);
  state.phase = 'gesture';
  modeManager.setMode('gesture');
  if (deps.td.isAnimating) deps.commitPendingTransition();

  const direction = dx < 0 ? 'forward' : 'backward';
  const current = deps.getCurrentSpread();
  const target = direction === 'forward' ? current + 1 : current - 1;
  if (target < 0 || target >= deps.getTotalSpreads()) {
    deps.td.startTracking(direction, current, null, timestamp);
  } else {
    deps.goToSpread(target);
    deps.td.interrupt(timestamp);
  }
  deps.td.updateTracking(dx, timestamp);
  deps.frameDriver.scheduleComposite();
}

function handleGestureMove(context: TouchHandlerContext, event: TouchEvent, touch: Touch): void {
  if (event.cancelable) event.preventDefault();
  const dx = touch.clientX - (context.state.startTouch?.x ?? 0);
  context.deps.td.updateTracking(dx, event.timeStamp);
  context.deps.frameDriver.scheduleComposite();
}

function handleTouchEnd(context: TouchHandlerContext, event: TouchEvent): void {
  const currentPhase = context.state.phase;
  clearTimer(context.state);
  if (currentPhase === 'gesture') {
    context.deps.td.releaseTracking();
    context.deps.frameDriver.scheduleComposite();
  } else if (currentPhase === 'long-press') {
    endLongPress(context, event);
  } else if (currentPhase === 'waiting' && !context.state.wasAnimating) {
    handleTapEnd(context, event);
  }
  resetTouchState(context.state);
}

function endLongPress(context: TouchHandlerContext, event: TouchEvent): void {
  const touch = event.changedTouches[0];
  if (touch) context.selection.handlePointerUp(context.toContent(touch));
}

function handleTapEnd(context: TouchHandlerContext, event: TouchEvent): void {
  context.selection.clear();
  const touch = event.changedTouches[0];
  if (touch) context.onTap(context.toContent(touch));
}

function clearTimer(state: TouchState): void {
  if (state.timer === null) return;
  clearTimeout(state.timer);
  state.timer = null;
}

function resetTouchState(state: TouchState): void {
  state.phase = 'idle';
  state.startTouch = null;
  state.wasAnimating = false;
}
