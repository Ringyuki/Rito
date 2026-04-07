import { animateSnapshotExit } from './animate';
import { createTransitionDOM, syncCanvasSize } from './dom';
import type { EngineState } from './engine-state';
import { createGestureState, gestureEnd, gestureMove, gestureReset, gestureStart } from './gesture';
import {
  resolveBackwardGesture,
  resolveForwardGesture,
  setupBackwardGesture,
  setupForwardGesture,
  trackBackwardGesture,
  trackForwardGesture,
} from './gesture-handlers';
import { captureSnapshot, hideSnapshot, showSnapshot } from './snapshot';
import {
  DEFAULT_TRANSITION_OPTIONS,
  type GesturePhase,
  type NavigationContext,
  type TransitionEngine,
  type TransitionOptions,
} from './types';

export type {
  TransitionEngine,
  TransitionOptions,
  TransitionPreset,
  NavigationContext,
} from './types';

/**
 * Create a transition engine that wraps an existing canvas element.
 * Call `mount(container)` to inject the wrapper div (containing the canvas)
 * into the target container.
 */
export function createTransitionEngine(
  canvas: HTMLCanvasElement,
  initialOptions?: Partial<TransitionOptions>,
): TransitionEngine {
  const state: EngineState = {
    dom: createTransitionDOM(canvas),
    options: { ...DEFAULT_TRANSITION_OPTIONS, ...initialOptions },
    animating: false,
    mounted: false,
    navContext: null,
    gesture: createGestureState(),
    preRenderedSpread: null,
    originalSpread: null,
  };

  return buildEngineInterface(state);
}

function buildEngineInterface(state: EngineState): TransitionEngine {
  const engine: TransitionEngine = {
    mount(container: HTMLElement): void {
      if (state.mounted) return;
      container.appendChild(state.dom.wrapper);
      state.mounted = true;
    },
    get mainCanvas(): HTMLCanvasElement {
      return state.dom.mainCanvas;
    },
    setSize(width: number, height: number, dpr: number): void {
      syncCanvasSize(state.dom.mainCanvas, width, height, dpr);
      state.dom.wrapper.style.width = `${String(width)}px`;
      state.dom.wrapper.style.height = `${String(height)}px`;
    },
    transitionTo: (d, r) => performTransition(state, d, r),
    configure(opts): void {
      state.options = { ...state.options, ...opts };
    },
    setNavigationContext(ctx: NavigationContext): void {
      state.navContext = ctx;
    },
    ...buildGestureHandlers(state, () => engine),
    get isAnimating(): boolean {
      return state.animating;
    },
    get gesturePhase(): GesturePhase {
      if (state.animating) return 'animating';
      const p = state.gesture.phase;
      if (p === 'locked') return 'tracking';
      return p;
    },
    onSwipeCommit: null,
    dispose(): void {
      if (state.mounted) {
        state.dom.wrapper.remove();
        state.mounted = false;
      }
    },
  };
  return engine;
}

// ---------------------------------------------------------------------------
// Programmatic transition (keyboard, ToC, links)
// ---------------------------------------------------------------------------

async function performTransition(
  state: EngineState,
  direction: 'forward' | 'backward',
  renderFn: () => void,
): Promise<void> {
  if (state.animating) return;
  // Abort any in-progress gesture
  if (state.gesture.phase !== 'idle') {
    abortGesture(state);
  }
  state.animating = true;
  try {
    captureSnapshot(state.dom.mainCanvas, state.dom.snapshotCanvas);
    showSnapshot(state.dom.snapshotCanvas);
    renderFn();
    await animateSnapshotExit(state.dom.snapshotCanvas, direction, state.options);
  } finally {
    hideSnapshot(state.dom.snapshotCanvas);
    state.animating = false;
  }
}

function abortGesture(state: EngineState): void {
  hideSnapshot(state.dom.snapshotCanvas);
  // Restore original page if we pre-rendered something
  if (state.originalSpread !== null && state.navContext) {
    state.navContext.renderSpread(state.originalSpread);
  }
  resetGestureState(state);
}

function resetGestureState(state: EngineState): void {
  gestureReset(state.gesture);
  state.preRenderedSpread = null;
  state.originalSpread = null;
}

// ---------------------------------------------------------------------------
// Gesture handlers
// ---------------------------------------------------------------------------

function buildGestureHandlers(
  state: EngineState,
  getEngine: () => TransitionEngine,
): Pick<TransitionEngine, 'handleTouchStart' | 'handleTouchMove' | 'handleTouchEnd'> {
  return {
    handleTouchStart(e: TouchEvent): void {
      if (state.animating) return;
      const touch = e.touches[0];
      if (!touch) return;
      gestureStart(state.gesture, touch.clientX, touch.clientY, e.timeStamp);
    },

    handleTouchMove(e: TouchEvent): void {
      if (state.animating) return;
      const touch = e.touches[0];
      if (!touch) return;
      handleGestureMove(state, touch.clientX, touch.clientY);
    },

    handleTouchEnd(e: TouchEvent): void {
      if (state.animating) return;
      void handleGestureEnd(state, e.timeStamp, getEngine);
    },
  };
}

function handleGestureMove(state: EngineState, x: number, y: number): void {
  const result = gestureMove(state.gesture, x, y);
  switch (result.kind) {
    case 'direction-locked':
      if (result.direction === 'forward') {
        setupForwardGesture(state);
        trackForwardGesture(state, result.dx);
      } else {
        setupBackwardGesture(state);
        trackBackwardGesture(state, result.dx);
      }
      break;
    case 'tracking':
      if (state.gesture.direction === 'forward') {
        trackForwardGesture(state, result.dx);
      } else {
        trackBackwardGesture(state, result.dx);
      }
      break;
    case 'pending':
    case 'vertical-abort':
      // No visual action needed
      break;
  }
}

async function handleGestureEnd(
  state: EngineState,
  time: number,
  getEngine: () => TransitionEngine,
): Promise<void> {
  const result = gestureEnd(state.gesture, time, state.options.swipeThreshold);

  switch (result.kind) {
    case 'tap':
    case 'no-op':
      resetGestureState(state);
      return;
    case 'commit': {
      state.animating = true;
      const target = state.preRenderedSpread;
      if (result.direction === 'forward') {
        await resolveForwardGesture(state, true);
      } else {
        await resolveBackwardGesture(state, true);
      }
      state.animating = false;
      if (target !== null) {
        getEngine().onSwipeCommit?.(result.direction, target);
      }
      resetGestureState(state);
      return;
    }
    case 'cancel': {
      state.animating = true;
      if (result.direction === 'forward') {
        await resolveForwardGesture(state, false);
      } else {
        await resolveBackwardGesture(state, false);
      }
      state.animating = false;
      resetGestureState(state);
      return;
    }
  }
}
