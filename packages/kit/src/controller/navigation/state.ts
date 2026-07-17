import type { ReaderIncrementalPagination, ReaderLocator, TocEntry } from '@ritojs/core';
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

export interface PendingTocNavigation {
  readonly attemptId: number;
  readonly entry: TocEntry;
}

export interface PendingLocatorNavigation {
  readonly attemptId: number;
  readonly locator: ReaderLocator;
  readonly locatorAbort: AbortController;
  readonly failureSource: string;
  readonly targetLabel: string;
}

export interface NavigationState {
  navigationAttemptId: number;
  pendingNavigation: PendingNavigation | undefined;
  pendingTocNavigation: PendingTocNavigation | undefined;
  pendingLocatorNavigation: PendingLocatorNavigation | undefined;
  disposed: boolean;
}

export function createNavigationState(): NavigationState {
  return {
    navigationAttemptId: 0,
    pendingNavigation: undefined,
    pendingTocNavigation: undefined,
    pendingLocatorNavigation: undefined,
    disposed: false,
  };
}

export function clearPendingNavigation(state: NavigationState): boolean {
  const previous = state.pendingNavigation;
  const previousToc = state.pendingTocNavigation;
  const previousLocator = state.pendingLocatorNavigation;
  const cancelledIntent =
    previous !== undefined || previousToc !== undefined || previousLocator !== undefined;
  state.pendingNavigation = undefined;
  state.pendingTocNavigation = undefined;
  state.pendingLocatorNavigation = undefined;
  previous?.growthAbort?.abort();
  previousLocator?.locatorAbort.abort();
  if (previous?.gesture && !previous.gesture.started) {
    previous.gesture.cancelled = true;
    previous.gesture.onUnavailable?.();
  }
  return cancelledIntent;
}

export interface SupersededNavigation {
  readonly attemptId: number;
  readonly cancelledPending: boolean;
}

export function supersedeNavigationForDirectInteraction(
  state: NavigationState,
  transition: TransitionDriver,
): SupersededNavigation {
  const attemptId = ++state.navigationAttemptId;
  const cancelledPending = clearPendingNavigation(state);
  if (state.navigationAttemptId === attemptId && transition.isAnimating) {
    transition.forceSettle();
  }
  return { attemptId, cancelledPending };
}

export function settleNavigationForContinuity(transition: TransitionDriver): number {
  const residualDx = transition.forceSettle();
  const width = transition.viewportWidth;
  return residualDx > 0 ? residualDx - width : residualDx + width;
}
