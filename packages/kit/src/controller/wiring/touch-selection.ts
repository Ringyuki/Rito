import type { PrimarySelectionDragSession } from './selection-drag';
import type { PrimarySelectionInputIntent } from './selection-drag';
import {
  clearTouchTimer,
  resetTouchState,
  type TouchHandlerContext,
  type TouchState,
} from './touch-context';

const LONG_PRESS_MS = 350;

export function scheduleLongPressSelection(context: TouchHandlerContext): void {
  const { state, modeManager, selection } = context;
  state.timer = setTimeout(() => {
    state.timer = null;
    const start = state.selectionStart;
    if (state.phase !== 'waiting' || !start) return;
    if (context.selectionNavigation && !state.selectionInput) {
      abandonSupersededTouch(context);
      return;
    }
    if (state.selectionInput && !state.selectionInput.owns()) {
      resetTouchState(state);
      return;
    }
    state.phase = 'long-press';
    modeManager.setMode('selection');
    state.selectionDrag = beginSelectionDrag(context, state.selectionInput, () => {
      selection.handlePointerDown(context.toContent(start), 'word');
    });
    if (!ownsSelectionDrag(state)) abandonSupersededTouch(context);
  }, LONG_PRESS_MS);
}

export function handleLongPressSelectionMove(
  context: TouchHandlerContext,
  event: TouchEvent,
  touch: Touch,
): void {
  if (event.cancelable) event.preventDefault();
  if (!ownsSelectionDrag(context.state)) {
    abandonSupersededTouch(context);
    return;
  }
  context.selection.handlePointerMove(context.toContent(touch));
  context.state.selectionDrag?.update(toClientPoint(touch));
}

export function finishLongPressSelection(context: TouchHandlerContext, touch: Touch): void {
  if (!ownsSelectionDrag(context.state)) {
    clearExactSelectionIfOwned(context);
    restoreGestureModeWhenIdle(context);
    return;
  }
  if (finishSelectionDrag(context.state)) {
    const input =
      context.state.selectionDrag?.resolveFinalInput?.(toClientPoint(touch)) ??
      context.toContent(touch);
    context.selection.handlePointerUp(input);
  } else {
    clearExactSelectionIfOwned(context);
    restoreGestureModeWhenIdle(context);
  }
}

export function cancelLongPressSelection(context: TouchHandlerContext): void {
  const ownsSelection = cancelSelectionDrag(context.state);
  try {
    if (ownsSelection) context.selection.clear();
  } finally {
    restoreGestureModeWhenIdle(context);
  }
}

function beginSelectionDrag(
  context: TouchHandlerContext,
  input: PrimarySelectionInputIntent | null,
  startSelection: () => void,
): PrimarySelectionDragSession | null {
  if (context.selectionNavigation && input) {
    return context.selectionNavigation.begin(input, startSelection);
  }
  startSelection();
  return null;
}

function ownsSelectionDrag(state: TouchState): boolean {
  return state.selectionDrag?.owns() ?? state.selectionInput?.owns() ?? true;
}

function abandonSupersededTouch(context: TouchHandlerContext): void {
  clearTouchTimer(context.state);
  clearExactSelectionIfOwned(context);
  restoreGestureModeWhenIdle(context);
  resetTouchState(context.state);
}

function finishSelectionDrag(state: TouchState): boolean {
  const session = state.selectionDrag;
  if (!session) return state.selectionInput?.owns() ?? true;
  if (!session.owns()) return false;
  return session.finish();
}

function cancelSelectionDrag(state: TouchState): boolean {
  const session = state.selectionDrag;
  if (!session) return state.selectionInput?.owns() ?? true;
  return session.cancel();
}

function clearExactSelectionIfOwned(context: TouchHandlerContext): void {
  if (context.state.selectionDrag?.cancel()) context.selection.clear();
}

function restoreGestureModeWhenIdle(context: TouchHandlerContext): void {
  if (context.selection.getState() === 'idle') context.modeManager.setMode('gesture');
}

function toClientPoint(touch: Touch): { readonly clientX: number; readonly clientY: number } {
  return { clientX: touch.clientX, clientY: touch.clientY };
}
