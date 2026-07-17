import type { SelectionEngine } from '../../interaction/index';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { InteractionModeManager } from '../interaction-mode/index';
import type { GestureNavigationToken } from '../navigation/index';
import type { GestureSessionContext } from './gesture-session';
import type {
  PrimarySelectionDragNavigation,
  PrimarySelectionDragSession,
  PrimarySelectionInputIntent,
} from './selection-drag';

export type TouchPhase = 'idle' | 'waiting' | 'gesture' | 'long-press';

export interface TouchState {
  phase: TouchPhase;
  timer: ReturnType<typeof setTimeout> | null;
  activeTouchId: number | null;
  startTouch: { x: number; y: number } | null;
  selectionStart: Touch | null;
  selectionInput: PrimarySelectionInputIntent | null;
  selectionDrag: PrimarySelectionDragSession | null;
  wasAnimating: boolean;
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

export interface TouchHandlerContext extends GestureSessionContext {
  readonly state: TouchState;
  readonly deps: GestureDeps;
  readonly selection: SelectionEngine;
  readonly modeManager: InteractionModeManager;
  readonly toContent: (touch: Touch) => { x: number; y: number };
  readonly onTap: (pos: { x: number; y: number }) => void;
  readonly selectionNavigation: PrimarySelectionDragNavigation | undefined;
}

export function createTouchHandlerContext(
  deps: GestureDeps,
  selection: SelectionEngine,
  modeManager: InteractionModeManager,
  toContent: (touch: Touch) => { x: number; y: number },
  onTap: (pos: { x: number; y: number }) => void,
  selectionNavigation: PrimarySelectionDragNavigation | undefined,
): TouchHandlerContext {
  return {
    state: createTouchState(),
    deps,
    selection,
    modeManager,
    toContent,
    onTap,
    selectionNavigation,
    gesture: null,
    ownsTransition: false,
  };
}

export function activeTouch(touches: TouchList, state: TouchState): Touch | undefined {
  const identifier = state.activeTouchId;
  if (identifier === null) return undefined;
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index];
    if (touch?.identifier === identifier) return touch;
  }
  return undefined;
}

export function clearTouchTimer(state: TouchState): void {
  if (state.timer === null) return;
  clearTimeout(state.timer);
  state.timer = null;
}

export function resetTouchState(state: TouchState): void {
  state.phase = 'idle';
  state.activeTouchId = null;
  state.startTouch = null;
  state.selectionStart = null;
  state.selectionInput = null;
  state.selectionDrag = null;
  state.wasAnimating = false;
}

function createTouchState(): TouchState {
  return {
    phase: 'idle',
    timer: null,
    activeTouchId: null,
    startTouch: null,
    selectionStart: null,
    selectionInput: null,
    selectionDrag: null,
    wasAnimating: false,
  };
}
