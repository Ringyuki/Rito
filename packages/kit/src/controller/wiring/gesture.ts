import type { SelectionEngine } from '../../interaction/index';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { FrameDriver } from '../../driver/frame-driver';
import type { InteractionModeManager } from '../interaction-mode/index';
import type { GestureNavigationToken } from '../navigation/index';
import type { DisposableCollection } from '../../utils/disposable';
import {
  activateGestureTransition,
  cancelDeferredGesture,
  cancelGestureSession,
  createGestureSession,
  finishGesture,
  settleOwnedTransition,
  updateGesture,
  watchOwnedTransition,
  type GestureSessionContext,
} from './gesture-session';

const LONG_PRESS_MS = 350;
const MOVE_SLOP_PX = 5;

type TouchPhase = 'idle' | 'waiting' | 'gesture' | 'long-press';

interface TouchState {
  phase: TouchPhase;
  timer: ReturnType<typeof setTimeout> | null;
  activeTouchId: number | null;
  startTouch: { x: number; y: number } | null;
  selectionStart: { x: number; y: number } | null;
  wasAnimating: boolean;
}

interface TouchHandlerContext extends GestureSessionContext {
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
  readonly startGestureNavigation: (
    index: number,
    onTransitionStart: () => void,
    onUnavailable?: () => void,
  ) => GestureNavigationToken;
  readonly getCurrentSpread: () => number;
  readonly getTotalSpreads: () => number;
  readonly isPaginationComplete: () => boolean;
  /** Commits an active same-direction transition before a rapid flip. */
  readonly commitPendingTransition: () => void;
}

/** Routes touch events to page swipes or long-press text selection. */
export function wireUnifiedTouchHandler(
  target: HTMLElement,
  gestureDeps: GestureDeps,
  selection: SelectionEngine,
  modeManager: InteractionModeManager,
  toContent: (touch: Touch) => { x: number; y: number },
  onTap: (pos: { x: number; y: number }) => void,
  disposables: DisposableCollection,
): void {
  const context = createTouchHandlerContext(gestureDeps, selection, modeManager, toContent, onTap);
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

function createTouchHandlerContext(
  deps: GestureDeps,
  selection: SelectionEngine,
  modeManager: InteractionModeManager,
  toContent: (touch: Touch) => { x: number; y: number },
  onTap: (pos: { x: number; y: number }) => void,
): TouchHandlerContext {
  return {
    state: {
      phase: 'idle',
      timer: null,
      activeTouchId: null,
      startTouch: null,
      selectionStart: null,
      wasAnimating: false,
    },
    deps,
    selection,
    modeManager,
    toContent,
    onTap,
    gesture: null,
    ownsTransition: false,
  };
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
  const selectionStart = context.toContent(touch);
  state.activeTouchId = touch.identifier;
  state.startTouch = { x: touch.clientX, y: touch.clientY };
  state.selectionStart = selectionStart;
  state.wasAnimating = deps.td.isAnimating;
  state.phase = 'waiting';
  if (!deps.td.isAnimating) scheduleLongPress(context);
}

function scheduleLongPress(context: TouchHandlerContext): void {
  const { state, modeManager, selection } = context;
  state.timer = setTimeout(() => {
    state.timer = null;
    const start = state.selectionStart;
    if (state.phase !== 'waiting' || !start) return;
    state.phase = 'long-press';
    modeManager.setMode('selection');
    selection.handlePointerDown(start);
  }, LONG_PRESS_MS);
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
  clearTimer(context.state);
  try {
    if (currentPhase === 'gesture') {
      const dx = touch.clientX - (context.state.startTouch?.x ?? touch.clientX);
      finishGesture(context, dx, event.timeStamp);
    } else if (currentPhase === 'long-press') {
      context.selection.handlePointerUp(context.toContent(touch));
    } else if (currentPhase === 'waiting' && !context.state.wasAnimating) {
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
  context.selection.clear();
  context.onTap(context.toContent(touch));
}

function cancelActiveTouch(context: TouchHandlerContext): void {
  const phase = context.state.phase;
  clearTimer(context.state);
  try {
    if (phase === 'long-press') {
      try {
        context.selection.clear();
      } finally {
        context.modeManager.setMode('gesture');
      }
    } else if (phase === 'gesture') {
      cancelGestureSession(context);
      context.deps.frameDriver.scheduleComposite();
    }
  } finally {
    resetTouchState(context.state);
  }
}

function activeTouch(touches: TouchList, state: TouchState): Touch | undefined {
  const identifier = state.activeTouchId;
  if (identifier === null) return undefined;
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index];
    if (touch?.identifier === identifier) return touch;
  }
  return undefined;
}

function clearTimer(state: TouchState): void {
  if (state.timer === null) return;
  clearTimeout(state.timer);
  state.timer = null;
}

function resetTouchState(state: TouchState): void {
  state.phase = 'idle';
  state.activeTouchId = null;
  state.startTouch = null;
  state.selectionStart = null;
  state.wasAnimating = false;
}
