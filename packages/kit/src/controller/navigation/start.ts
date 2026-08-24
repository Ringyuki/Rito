import type { Reader } from '@ritojs/core';
import type { NavigationDeps } from './index';
import type { GestureNavigationRequest, NavigationState } from './state';

export function emitNavigationStart(
  state: NavigationState,
  deps: NavigationDeps,
  reader: Reader,
  attemptId: number,
  target: number,
  direction: 'forward' | 'backward',
  previous: number,
  continuityDx: number,
  gesture?: GestureNavigationRequest,
): void {
  if (gesture?.cancelled || attemptId !== state.navigationAttemptId) return;
  const spread = reader.spreads[target];
  deps.setCurrentSpread(target);
  reader.notifyActiveSpread(target);
  if (!ownsNavigationStart(state, deps, attemptId, target)) return;
  if (gesture?.cancelled) {
    restoreCancelledGesture(state, deps, reader, attemptId, previous, false);
    return;
  }
  if (spread) deps.emitter.emit('spreadChange', { spreadIndex: target, spread });
  if (!ownsNavigationStart(state, deps, attemptId, target)) return;
  if (gesture?.cancelled) {
    restoreCancelledGesture(state, deps, reader, attemptId, previous, true);
    return;
  }
  deps.td.goToTarget(direction, previous, target, continuityDx);
  if (gesture) {
    gesture.started = true;
    gesture.onTransitionStart();
  }
  deps.emitter.emit('transitionStart', { direction });
  deps.frameDriver.scheduleComposite();
}

function restoreCancelledGesture(
  state: NavigationState,
  deps: NavigationDeps,
  reader: Reader,
  attemptId: number,
  previous: number,
  targetWasEmitted: boolean,
): void {
  deps.setCurrentSpread(previous);
  reader.notifyActiveSpread(previous);
  if (!ownsNavigationStart(state, deps, attemptId, previous)) return;
  const spread = reader.spreads[previous];
  if (targetWasEmitted && spread) {
    deps.emitter.emit('spreadChange', { spreadIndex: previous, spread });
    if (!ownsNavigationStart(state, deps, attemptId, previous)) return;
  }
  deps.onNavigationCancelled?.();
  if (!ownsNavigationStart(state, deps, attemptId, previous)) return;
  deps.frameDriver.scheduleComposite();
}

function ownsNavigationStart(
  state: NavigationState,
  deps: NavigationDeps,
  attemptId: number,
  spreadIndex: number,
): boolean {
  return attemptId === state.navigationAttemptId && deps.getCurrentSpread() === spreadIndex;
}
