import type { ReaderIncrementalPagination, TocEntry } from '@ritojs/core';
import type { TransitionDriver } from '../../driver/transition-driver';

export interface GestureNavigationRequest {
  readonly onTransitionStart: () => void;
  readonly onUnavailable?: (() => void) | undefined;
  started: boolean;
  cancelled: boolean;
}

export interface PendingNavigation {
  readonly attemptId: number;
  readonly target: number;
  readonly direction: 'forward' | 'backward';
  readonly previous: number;
  readonly continuityDx: number;
  readonly gesture?: GestureNavigationRequest;
  readonly growthPagination?: ReaderIncrementalPagination;
  growthAbort?: AbortController | undefined;
}

export interface NavigationAttempt {
  readonly claimedIntent: boolean;
  readonly attemptId?: number;
  readonly pendingNavigation?: PendingNavigation;
}

export interface NavigationState {
  navigationAttemptId: number;
  pendingNavigation: PendingNavigation | undefined;
  pendingTocEntry: TocEntry | undefined;
  disposed: boolean;
}

export function createNavigationState(): NavigationState {
  return {
    navigationAttemptId: 0,
    pendingNavigation: undefined,
    pendingTocEntry: undefined,
    disposed: false,
  };
}

export function clearPendingNavigation(state: NavigationState): boolean {
  const previous = state.pendingNavigation;
  const cancelledIntent = previous !== undefined || state.pendingTocEntry !== undefined;
  state.pendingNavigation = undefined;
  state.pendingTocEntry = undefined;
  previous?.growthAbort?.abort();
  if (previous?.gesture && !previous.gesture.started) {
    previous.gesture.cancelled = true;
    previous.gesture.onUnavailable?.();
  }
  return cancelledIntent;
}

export function supersedeNavigationForPositionIntent(
  state: NavigationState,
  transition: TransitionDriver,
): void {
  state.navigationAttemptId += 1;
  clearPendingNavigation(state);
  if (transition.isAnimating) transition.forceSettle();
}

export function settleNavigationForContinuity(transition: TransitionDriver): number {
  const residualDx = transition.forceSettle();
  const width = transition.viewportWidth;
  return residualDx > 0 ? residualDx - width : residualDx + width;
}
