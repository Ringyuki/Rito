import type { SelectionEngine } from '../../interaction/index';
import type { TransitionPoint } from '../../driver/effects';
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

/**
 * Where a touch is: `waiting` to be told a tap, a long press or a turn;
 * `sliding` across the way pages turn (up or down the page, as pages turn),
 * no tap nor press any more, a turn once it goes the way pages turn.
 */
export type TouchPhase = 'idle' | 'waiting' | 'sliding' | 'gesture' | 'long-press';

export interface TouchState {
  phase: TouchPhase;
  timer: ReturnType<typeof setTimeout> | null;
  /** The whole-book layout held back while `timer` waits to tell a long press from a tap. */
  bookHold: (() => void) | null;
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
  /**
   * Retires older navigation work before the finger's own turn. A turn in
   * flight is cut into: its outcome is settled, and the finger takes its
   * picture from where it is.
   */
  readonly supersedeTurnInFlight: () => void;
  /** Holds the whole-book layout back until the returned function is called. */
  readonly holdBookLayout?: (() => () => void) | undefined;
}

export interface TouchHandlerContext extends GestureSessionContext {
  readonly state: TouchState;
  readonly deps: GestureDeps;
  readonly selection: SelectionEngine;
  readonly modeManager: InteractionModeManager;
  readonly toContent: (touch: Touch) => { x: number; y: number };
  /** A client point as the display canvas sees it: from its top-left corner. */
  readonly toLocal: (client: TransitionPoint) => TransitionPoint;
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
  toLocal: (client: TransitionPoint) => TransitionPoint = (client) => client,
): TouchHandlerContext {
  return {
    state: createTouchState(),
    deps,
    selection,
    modeManager,
    toContent,
    toLocal,
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
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  releaseTouchBookHold(state);
}

export function releaseTouchBookHold(state: TouchState): void {
  const release = state.bookHold;
  state.bookHold = null;
  release?.();
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
    bookHold: null,
    activeTouchId: null,
    startTouch: null,
    selectionStart: null,
    selectionInput: null,
    selectionDrag: null,
    wasAnimating: false,
  };
}
