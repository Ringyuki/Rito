/**
 * Direction-specific gesture setup, tracking, and resolution.
 * Extracted from index.ts to stay within ESLint line limits.
 */

import {
  animateBounceBackward,
  animateBounceForward,
  animateSlideCommitBackward,
  animateSlideCommitForward,
} from './animate';
import {
  captureSnapshot,
  hideSnapshot,
  setSnapshotTransform,
  showSnapshot,
  showSnapshotAt,
} from './snapshot';
import type { EngineState } from './engine-state';

// ---------------------------------------------------------------------------
// Setup — called once when direction is first detected
// ---------------------------------------------------------------------------

/** Forward swipe: snapshot = current page on top, mainCanvas = next page underneath. */
export function setupForwardGesture(state: EngineState): void {
  const { dom, navContext } = state;
  if (!navContext) return;

  state.originalSpread = navContext.currentSpread;
  const nextIdx = navContext.currentSpread + 1;

  captureSnapshot(dom.mainCanvas, dom.snapshotCanvas);

  if (nextIdx >= navContext.totalSpreads) {
    // At last page — elastic bounce only, no pre-render
    state.preRenderedSpread = null;
    showSnapshot(dom.snapshotCanvas);
    return;
  }

  navContext.renderSpread(nextIdx);
  state.preRenderedSpread = nextIdx;
  showSnapshot(dom.snapshotCanvas);
}

/** Backward swipe: snapshot = prev page starting off-screen left, mainCanvas = current page. */
export function setupBackwardGesture(state: EngineState): void {
  const { dom, navContext } = state;
  if (!navContext) return;

  state.originalSpread = navContext.currentSpread;
  const prevIdx = navContext.currentSpread - 1;

  if (prevIdx < 0) {
    // At first page — elastic bounce only, no snapshot
    state.preRenderedSpread = null;
    return;
  }

  // Render prev → capture → restore current
  navContext.renderSpread(prevIdx);
  captureSnapshot(dom.mainCanvas, dom.snapshotCanvas);
  navContext.renderSpread(navContext.currentSpread);
  state.preRenderedSpread = prevIdx;
  showSnapshotAt(dom.snapshotCanvas, '-100%');
}

// ---------------------------------------------------------------------------
// Tracking — called on every touchmove after direction is locked
// ---------------------------------------------------------------------------

export function trackForwardGesture(state: EngineState, dx: number): void {
  // Forward: snapshot can only move left (dx <= 0)
  const clamped = Math.min(dx, 0);
  const effectiveDx =
    state.preRenderedSpread === null ? clamped * state.options.elasticFactor : clamped;
  setSnapshotTransform(state.dom.snapshotCanvas, effectiveDx, 1);
}

export function trackBackwardGesture(state: EngineState, dx: number): void {
  const w = state.dom.wrapper.clientWidth || 1;
  // Backward: snapshot slides in from left, clamp so it doesn't overshoot past origin
  const clamped = Math.max(dx, 0);
  if (state.preRenderedSpread === null) {
    setSnapshotTransform(state.dom.snapshotCanvas, clamped * state.options.elasticFactor, 1);
    return;
  }
  setSnapshotTransform(state.dom.snapshotCanvas, Math.min(-w + clamped, 0), 1);
}

// ---------------------------------------------------------------------------
// Resolution — called on touchend to animate commit or cancel
// ---------------------------------------------------------------------------

export async function resolveForwardGesture(state: EngineState, commit: boolean): Promise<void> {
  if (commit && state.preRenderedSpread !== null) {
    await animateSlideCommitForward(state.dom.snapshotCanvas, state.options);
    hideSnapshot(state.dom.snapshotCanvas);
    state.navContext?.renderSpread(state.preRenderedSpread);
    return;
  }
  // Cancel or boundary — bounce back
  await animateBounceForward(state.dom.snapshotCanvas, 200);
  hideSnapshot(state.dom.snapshotCanvas);
  // Restore original page on mainCanvas (was pre-rendered to next)
  if (state.originalSpread !== null && state.preRenderedSpread !== null && state.navContext) {
    state.navContext.renderSpread(state.originalSpread);
  }
}

export async function resolveBackwardGesture(state: EngineState, commit: boolean): Promise<void> {
  if (commit && state.preRenderedSpread !== null) {
    await animateSlideCommitBackward(state.dom.snapshotCanvas, state.options);
    // Snapshot now covers mainCanvas at translateX(0). Swap: render prev on mainCanvas.
    if (state.navContext) {
      state.navContext.renderSpread(state.preRenderedSpread);
    }
    hideSnapshot(state.dom.snapshotCanvas);
    return;
  }
  // Cancel or boundary — bounce back off-screen
  if (state.preRenderedSpread !== null) {
    await animateBounceBackward(state.dom.snapshotCanvas, 200);
  }
  hideSnapshot(state.dom.snapshotCanvas);
  // mainCanvas was never changed (still shows current), no restore needed
}

/** Apply elastic resistance to a displacement. */
export function applyElastic(dx: number, factor: number, threshold: number): number {
  const absDx = Math.abs(dx);
  if (absDx <= threshold) return dx;
  const sign = dx < 0 ? -1 : 1;
  return sign * (threshold + (absDx - threshold) * factor);
}
