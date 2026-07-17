import type { SelectionEngine } from '../../interaction/index';
import type { InteractionModeManager } from '../interaction-mode/index';
import type { DisposableCollection } from '../../utils/disposable';
import type { PrimarySelectionDragNavigation } from './selection-drag';
import {
  activateGestureTransition,
  cancelDeferredGesture,
  cancelGestureSession,
  createGestureSession,
  finishGesture,
  settleOwnedTransition,
  updateGesture,
  watchOwnedTransition,
} from './gesture-session';
import {
  activeTouch,
  clearTouchTimer,
  createTouchHandlerContext,
  resetTouchState,
  type GestureDeps,
  type TouchHandlerContext,
} from './touch-context';
import {
  cancelLongPressSelection,
  finishLongPressSelection,
  handleLongPressSelectionMove,
  scheduleLongPressSelection,
} from './touch-selection';

const MOVE_SLOP_PX = 5;
export type { GestureDeps } from './touch-context';

/** Routes touch events to page swipes or long-press text selection. */
export function wireUnifiedTouchHandler(
  target: HTMLElement,
  gestureDeps: GestureDeps,
  selection: SelectionEngine,
  modeManager: InteractionModeManager,
  toContent: (touch: Touch) => { x: number; y: number },
  onTap: (pos: { x: number; y: number }) => void,
  disposables: DisposableCollection,
  selectionNavigation?: PrimarySelectionDragNavigation,
): void {
  const context = createTouchHandlerContext(
    gestureDeps,
    selection,
    modeManager,
    toContent,
    onTap,
    selectionNavigation,
  );
  const stopWatchingSettled = watchOwnedTransition(context);
  let removeTouchListeners = (): void => undefined;
  disposables.add(() => {
    removeTouchListeners();
    cancelActiveTouch(context);
    cancelDeferredGesture(context);
    settleOwnedTransition(context);
    stopWatchingSettled();
  });
  removeTouchListeners = bindTouchListeners(target, context);
}

function bindTouchListeners(target: HTMLElement, context: TouchHandlerContext): () => void {
  const onStart = (event: TouchEvent): void => {
    handleTouchStart(context, event);
  };
  const onMove = (event: TouchEvent): void => {
    handleTouchMove(context, event);
  };
  const onEnd = (event: TouchEvent): void => {
    handleTouchEnd(context, event);
  };
  const onCancel = (event: TouchEvent): void => {
    handleTouchCancel(context, event);
  };

  const remove = (): void => {
    target.removeEventListener('touchstart', onStart);
    target.removeEventListener('touchmove', onMove);
    target.removeEventListener('touchend', onEnd);
    target.removeEventListener('touchcancel', onCancel);
  };
  try {
    target.addEventListener('touchstart', onStart, { passive: false });
    target.addEventListener('touchmove', onMove, { passive: false });
    target.addEventListener('touchend', onEnd);
    target.addEventListener('touchcancel', onCancel);
    return remove;
  } catch (error: unknown) {
    remove();
    throw error;
  }
}

function handleTouchStart(context: TouchHandlerContext, event: TouchEvent): void {
  if (context.state.activeTouchId !== null) return;
  cancelDeferredGesture(context);
  const touch = event.changedTouches[0] ?? event.touches[0];
  if (!touch) return;
  const { state, deps } = context;
  const wasAnimating = deps.td.isAnimating;
  const selectionInput = context.selectionNavigation?.claim() ?? null;
  if (context.selectionNavigation && !selectionInput) return;
  state.activeTouchId = touch.identifier;
  state.startTouch = { x: touch.clientX, y: touch.clientY };
  state.selectionStart = touch;
  state.selectionInput = selectionInput;
  state.wasAnimating = wasAnimating;
  state.phase = 'waiting';
  if (!wasAnimating) scheduleLongPressSelection(context);
}

function handleTouchMove(context: TouchHandlerContext, event: TouchEvent): void {
  if (!activeTouch(event.changedTouches, context.state)) return;
  const touch = activeTouch(event.touches, context.state);
  if (!touch) return;
  if (context.state.phase === 'waiting' && context.state.startTouch) {
    handleWaitingMove(context, event, touch);
  } else if (context.state.phase === 'gesture') {
    handleGestureMove(context, event, touch);
  } else if (context.state.phase === 'long-press') {
    handleLongPressSelectionMove(context, event, touch);
  }
}

function handleWaitingMove(context: TouchHandlerContext, event: TouchEvent, touch: Touch): void {
  const start = context.state.startTouch;
  if (!start) return;
  const dx = touch.clientX - start.x;
  const dy = touch.clientY - start.y;
  if (Math.abs(dx) <= MOVE_SLOP_PX && Math.abs(dy) <= MOVE_SLOP_PX) return;
  if (!(context.state.selectionInput?.owns() ?? true)) {
    clearTouchTimer(context.state);
    resetTouchState(context.state);
    return;
  }
  beginGesture(context, dx, event.timeStamp);
}

function beginGesture(context: TouchHandlerContext, dx: number, timestamp: number): void {
  const { state, deps, modeManager } = context;
  clearTouchTimer(state);
  state.phase = 'gesture';
  modeManager.setMode('gesture');
  if (deps.td.isAnimating) deps.commitPendingTransition();

  const direction = dx < 0 ? 'forward' : 'backward';
  const current = deps.getCurrentSpread();
  const target = direction === 'forward' ? current + 1 : current - 1;
  const session = createGestureSession(dx, timestamp);
  context.gesture = session;
  if (target < 0 || (target >= deps.getTotalSpreads() && deps.isPaginationComplete())) {
    deps.td.startTracking(direction, current, null, timestamp);
    session.started = true;
    context.ownsTransition = true;
    deps.td.updateTracking(session.latestDx, session.latestTimestamp);
  } else {
    const token = deps.startGestureNavigation(
      target,
      () => {
        activateGestureTransition(context, session);
      },
      () => {
        if (context.gesture !== session || session.started) return;
        session.status = 'cancelled';
        session.token = null;
        context.gesture = null;
        deps.frameDriver.scheduleComposite();
      },
    );
    if (!session.started) session.token = token;
  }
  deps.frameDriver.scheduleComposite();
}

function handleGestureMove(context: TouchHandlerContext, event: TouchEvent, touch: Touch): void {
  if (event.cancelable) event.preventDefault();
  const dx = touch.clientX - (context.state.startTouch?.x ?? 0);
  updateGesture(context, dx, event.timeStamp);
}

function handleTouchEnd(context: TouchHandlerContext, event: TouchEvent): void {
  const touch = activeTouch(event.changedTouches, context.state);
  if (!touch) return;
  const currentPhase = context.state.phase;
  clearTouchTimer(context.state);
  try {
    if (currentPhase === 'gesture') {
      const dx = touch.clientX - (context.state.startTouch?.x ?? touch.clientX);
      finishGesture(context, dx, event.timeStamp);
    } else if (currentPhase === 'long-press') {
      finishLongPressSelection(context, touch);
    } else if (
      currentPhase === 'waiting' &&
      !context.state.wasAnimating &&
      (context.state.selectionInput?.owns() ?? true)
    ) {
      handleTapEnd(context, touch);
    }
  } finally {
    resetTouchState(context.state);
  }
}

function handleTouchCancel(context: TouchHandlerContext, event: TouchEvent): void {
  if (context.state.activeTouchId === null) return;
  if (event.changedTouches.length > 0 && !activeTouch(event.changedTouches, context.state)) return;
  cancelActiveTouch(context);
}

function handleTapEnd(context: TouchHandlerContext, touch: Touch): void {
  const input = context.state.selectionInput;
  context.selection.clear();
  if (input?.owns() ?? true) context.onTap(context.toContent(touch));
}

function cancelActiveTouch(context: TouchHandlerContext): void {
  const phase = context.state.phase;
  clearTouchTimer(context.state);
  try {
    if (phase === 'long-press') {
      cancelLongPressSelection(context);
    } else if (phase === 'gesture') {
      cancelGestureSession(context);
      context.deps.frameDriver.scheduleComposite();
    }
  } finally {
    resetTouchState(context.state);
  }
}
