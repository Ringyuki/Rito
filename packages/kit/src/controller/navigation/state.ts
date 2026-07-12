import type { TocEntry } from '@ritojs/core';
import type { TransitionDriver } from '../../driver/transition-driver';

export interface GestureNavigationRequest {
  readonly onTransitionStart: () => void;
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
}

export function clearPendingNavigation(state: NavigationState): boolean {
  const previous = state.pendingNavigation;
  const cancelledIntent = previous !== undefined || state.pendingTocEntry !== undefined;
  if (previous?.gesture && !previous.gesture.started) previous.gesture.cancelled = true;
  state.pendingNavigation = undefined;
  state.pendingTocEntry = undefined;
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
