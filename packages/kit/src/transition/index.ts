import { animateBounceBack, animateSnapshotExit } from './animate';
import { createTransitionDOM, syncCanvasSize, type TransitionDOM } from './dom';
import { createGestureState, handleEnd, handleMove, handleStart } from './gesture';
import { captureSnapshot, hideSnapshot, showSnapshot } from './snapshot';
import { DEFAULT_TRANSITION_OPTIONS, type TransitionEngine, type TransitionOptions } from './types';

export type { TransitionEngine, TransitionOptions, TransitionPreset } from './types';

interface EngineState {
  dom: TransitionDOM;
  options: TransitionOptions;
  animating: boolean;
  mounted: boolean;
}

function buildGestureHandlers(
  state: EngineState,
  getEngine: () => TransitionEngine,
): Pick<TransitionEngine, 'handleTouchStart' | 'handleTouchMove' | 'handleTouchEnd'> {
  const gesture = createGestureState();

  return {
    handleTouchStart(e: TouchEvent): void {
      if (state.animating) return;
      captureSnapshot(state.dom.mainCanvas, state.dom.snapshotCanvas);
      showSnapshot(state.dom.snapshotCanvas);
      handleStart(gesture, e);
    },

    handleTouchMove(e: TouchEvent): void {
      const dx = handleMove(gesture, e, state.options);
      if (dx === null) {
        hideSnapshot(state.dom.snapshotCanvas);
        return;
      }
      const snap = state.dom.snapshotCanvas;
      snap.style.transition = 'none';
      snap.style.transform = `translateX(${String(dx)}px)`;
      const w = state.dom.wrapper.clientWidth || 1;
      snap.style.opacity = String(Math.max(0, 1 - Math.abs(dx) / w));
    },

    handleTouchEnd(): void {
      const result = handleEnd(gesture, state.options);
      if (result === 'cancel') {
        void animateBounceBack(state.dom.snapshotCanvas, 200).then(() => {
          hideSnapshot(state.dom.snapshotCanvas);
        });
        return;
      }
      getEngine().onSwipeCommit?.(result);
    },
  };
}

async function performTransition(
  state: EngineState,
  direction: 'forward' | 'backward',
  renderFn: () => void,
): Promise<void> {
  if (state.animating) return;
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

export function createTransitionEngine(
  initialOptions?: Partial<TransitionOptions>,
): TransitionEngine {
  const state: EngineState = {
    dom: createTransitionDOM(),
    options: { ...DEFAULT_TRANSITION_OPTIONS, ...initialOptions },
    animating: false,
    mounted: false,
  };

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
    ...buildGestureHandlers(state, () => engine),
    get isAnimating(): boolean {
      return state.animating;
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
