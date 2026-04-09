import type { SelectionEngine } from 'rito/selection';
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
  const ts: TouchState = { phase: 'idle', timer: null, startTouch: null, wasAnimating: false };
  const {
    td,
    frameDriver,
    goToSpread,
    getCurrentSpread,
    getTotalSpreads,
    commitPendingTransition,
  } = gestureDeps;

  const clearTimer = (): void => {
    if (ts.timer !== null) {
      clearTimeout(ts.timer);
      ts.timer = null;
    }
  };

  const onStart = (e: TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch) return;

    ts.startTouch = { x: touch.clientX, y: touch.clientY };
    ts.wasAnimating = td.isAnimating;
    ts.phase = 'waiting';

    // Only set long-press timer if no animation is in progress
    if (!td.isAnimating) {
      ts.timer = setTimeout(() => {
        ts.timer = null;
        if (ts.phase !== 'waiting') return;
        ts.phase = 'long-press';
        modeManager.setMode('selection');
        selection.handlePointerDown(toContent(touch));
      }, LONG_PRESS_MS);
    }
  };

  const onMove = (e: TouchEvent): void => {
    const touch = e.touches[0];
    if (!touch) return;

    if (ts.phase === 'waiting' && ts.startTouch) {
      const dx = touch.clientX - ts.startTouch.x;
      const dy = touch.clientY - ts.startTouch.y;
      if (Math.abs(dx) > MOVE_SLOP_PX || Math.abs(dy) > MOVE_SLOP_PX) {
        clearTimer();
        ts.phase = 'gesture';
        modeManager.setMode('gesture');

        if (td.isAnimating) {
          // Commit any in-progress animation before starting a new gesture.
          // Works for both same-direction (rapid flip) and opposite-direction (reversal).
          commitPendingTransition();
        }

        // td is now idle — start fresh navigation
        const direction = dx < 0 ? 'forward' : 'backward';
        const curr = getCurrentSpread();
        const targetIdx = direction === 'forward' ? curr + 1 : curr - 1;

        if (targetIdx < 0 || targetIdx >= getTotalSpreads()) {
          td.startTracking(direction, curr, null, e.timeStamp);
        } else {
          goToSpread(targetIdx);
          td.interrupt(e.timeStamp);
        }

        td.updateTracking(dx, e.timeStamp);
        frameDriver.scheduleComposite();
      }
      return;
    }

    if (ts.phase === 'gesture') {
      if (e.cancelable) e.preventDefault();
      const dx = touch.clientX - (ts.startTouch?.x ?? 0);
      td.updateTracking(dx, e.timeStamp);
      frameDriver.scheduleComposite();
      return;
    }

    if (ts.phase === 'long-press') {
      selection.handlePointerMove(toContent(touch));
    }
  };

  const onEnd = (e: TouchEvent): void => {
    const currentPhase = ts.phase;
    clearTimer();

    if (currentPhase === 'gesture') {
      td.releaseTracking();
      frameDriver.scheduleComposite();
    } else if (currentPhase === 'long-press') {
      const touch = e.changedTouches[0];
      if (touch) selection.handlePointerUp(toContent(touch));
    } else if (currentPhase === 'waiting' && !ts.wasAnimating) {
      // Quick tap — only fire if there was no animation at touchstart
      selection.clear();
      const touch = e.changedTouches[0];
      if (touch) onTap(toContent(touch));
    }

    ts.phase = 'idle';
    ts.startTouch = null;
    ts.wasAnimating = false;
  };

  target.addEventListener('touchstart', onStart, { passive: false });
  target.addEventListener('touchmove', onMove, { passive: false });
  target.addEventListener('touchend', onEnd);

  disposables.add(() => {
    clearTimer();
    target.removeEventListener('touchstart', onStart);
    target.removeEventListener('touchmove', onMove);
    target.removeEventListener('touchend', onEnd);
  });
}
