import type { Reader } from '@ritojs/core';
import type { GestureNavigationToken, NavigationDeps } from './index';
import * as growth from './growth';
import * as jump from './jump';
import { emitNavigationStart } from './start';
import * as navState from './state';

type State = navState.NavigationState;
type Attempt = navState.NavigationAttempt;
type GestureRequest = navState.GestureNavigationRequest;

export function createLocatorNavigator(
  state: State,
  deps: NavigationDeps,
): (spreadIndex: number) => void {
  return (spreadIndex): void => {
    replaceWithNavigation(state, deps, goToSpread(state, deps, spreadIndex));
  };
}

export function startNavigation(state: State, deps: NavigationDeps, index: number): void {
  replaceWithNavigation(state, deps, goToSpread(state, deps, index));
}

export function startGestureNavigation(
  state: State,
  deps: NavigationDeps,
  index: number,
  onTransitionStart: () => void,
  onUnavailable?: () => void,
): GestureNavigationToken {
  if (state.disposed) {
    onUnavailable?.();
    return { cancel() {} };
  }
  const request: GestureRequest = {
    onTransitionStart,
    ...(onUnavailable ? { onUnavailable } : {}),
    started: false,
    cancelled: false,
  };
  replaceWithNavigation(state, deps, goToSpread(state, deps, index, request));
  return createGestureToken(state, deps, request);
}

function createGestureToken(
  state: State,
  deps: NavigationDeps,
  request: GestureRequest,
): GestureNavigationToken {
  return {
    cancel(): void {
      if (request.started) return;
      request.cancelled = true;
      if (state.pendingNavigation?.gesture === request) {
        state.navigationAttemptId += 1;
        navState.clearPendingNavigation(state);
        deps.onNavigationCancelled?.();
      }
    },
  };
}

function goToSpread(
  state: State,
  deps: NavigationDeps,
  index: number,
  gesture?: GestureRequest,
): Attempt {
  const initialReader = deps.getReader();
  if (state.disposed || !initialReader) return { claimedIntent: false };
  const initialTarget = growth.navigationTarget(initialReader, index);
  const initialPrevious = deps.getCurrentSpread();
  const attemptId = jump.claimNavigationAttempt(state, deps);
  if (attemptId !== state.navigationAttemptId) return { claimedIntent: true, attemptId };
  if (initialTarget.index === initialPrevious && !initialTarget.pagination) {
    return completeNoOpNavigation(deps, attemptId, gesture);
  }

  const continuityDx = navigationContinuity(state, deps, attemptId);
  const previous = deps.getCurrentSpread();
  if (attemptId !== state.navigationAttemptId) return { claimedIntent: true, attemptId };
  const reader = deps.getReader();
  if (!reader) return { claimedIntent: true, attemptId };
  const target = growth.navigationTarget(reader, index);
  if (target.index === previous && !target.pagination) {
    return completeNoOpNavigation(deps, attemptId, gesture);
  }
  return createResolvedSpreadAttempt(
    state,
    deps,
    reader,
    attemptId,
    target,
    previous,
    continuityDx,
    gesture,
  );
}

function navigationContinuity(state: State, deps: NavigationDeps, attemptId: number): number {
  if (!deps.td.isAnimating && state.zeroContinuityAttemptId !== attemptId) return 0;
  return navState.settleNavigationAttemptForContinuity(state, deps.td, attemptId);
}

function createResolvedSpreadAttempt(
  state: State,
  deps: NavigationDeps,
  reader: Reader,
  attemptId: number,
  target: ReturnType<typeof growth.navigationTarget>,
  previous: number,
  continuityDx: number,
  gesture?: GestureRequest,
): Attempt {
  if (state.activeChapterLocalTransition || state.finalizingChapterLocalTransition) {
    return createChapterLocalPendingAttempt(state, deps, attemptId, target, previous, gesture);
  }
  if (target.pagination) {
    return growth.createSpreadGrowthAttempt(
      state,
      deps,
      target.pagination,
      attemptId,
      target.index,
      previous,
      continuityDx,
      gesture,
    );
  }
  return createKnownSpreadAttempt(
    state,
    deps,
    reader,
    attemptId,
    target.index,
    previous,
    continuityDx,
    gesture,
  );
}

function createChapterLocalPendingAttempt(
  state: State,
  deps: NavigationDeps,
  attemptId: number,
  target: ReturnType<typeof growth.navigationTarget>,
  previous: number,
  gesture?: GestureRequest,
): Attempt {
  if (target.pagination) {
    return growth.createSpreadGrowthAttempt(
      state,
      deps,
      target.pagination,
      attemptId,
      target.index,
      previous,
      0,
      gesture,
    );
  }
  return {
    claimedIntent: true,
    attemptId,
    pendingNavigation: {
      attemptId,
      target: target.index,
      direction: target.index > previous ? 'forward' : 'backward',
      previous,
      continuityDx: 0,
      ...(gesture ? { gesture } : {}),
    },
  };
}

function createKnownSpreadAttempt(
  state: State,
  deps: NavigationDeps,
  reader: Reader,
  attemptId: number,
  target: number,
  previous: number,
  continuityDx: number,
  gesture?: GestureRequest,
): Attempt {
  const direction = target > previous ? 'forward' : 'backward';
  if (!growth.ensureIncomingSlot(deps, target, direction)) {
    deps.frameDriver.scheduleComposite();
    return {
      claimedIntent: true,
      attemptId,
      pendingNavigation: {
        attemptId,
        target,
        direction,
        previous,
        continuityDx,
        ...(gesture ? { gesture } : {}),
      },
    };
  }
  emitNavigationStart(
    state,
    deps,
    reader,
    attemptId,
    target,
    direction,
    previous,
    continuityDx,
    gesture,
  );
  return { claimedIntent: true, attemptId };
}

function completeNoOpNavigation(
  deps: NavigationDeps,
  attemptId: number,
  gesture?: GestureRequest,
): Attempt {
  if (gesture && !gesture.started) {
    gesture.cancelled = true;
    gesture.onUnavailable?.();
  }
  deps.onNavigationCancelled?.();
  return { claimedIntent: true, attemptId };
}

function replaceWithNavigation(state: State, deps: NavigationDeps, attempt: Attempt): void {
  if (!attempt.claimedIntent) {
    const cancelledIntent = navState.clearPendingNavigation(state);
    if (cancelledIntent) {
      state.navigationAttemptId += 1;
      deps.onNavigationCancelled?.();
    }
    return;
  }
  if (attempt.attemptId !== state.navigationAttemptId) return;
  state.pendingNavigation = attempt.pendingNavigation;
}
