import type { Reader, ReaderLocator, TocEntry } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../../painter/buffer-pool';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';
import {
  clearPendingNavigation,
  createNavigationState,
  settleNavigationForContinuity,
  supersedeNavigationForPositionIntent,
  type GestureNavigationRequest,
  type NavigationAttempt,
  type NavigationState,
} from './state';
import {
  claimNavigationAttempt,
  jumpToSpread,
  jumpToSpreadIfReady,
  type NavigationJumpOutcome,
} from './jump';
import {
  continuePendingNavigation,
  createSpreadGrowthAttempt,
  ensureIncomingSlot,
  navigationTarget,
} from './growth';
import { emitNavigationStart } from './start';
import { navigateReaderLocator, navigateTocEntry, retryPendingTocEntry } from './toc-growth';

export interface NavigationDeps {
  getReader: () => Reader | null;
  getCurrentSpread: () => number;
  setCurrentSpread: (index: number) => void;
  getRenderScale: () => number;
  emitter: TypedEmitter<ReaderControllerEvents>;
  td: TransitionDriver;
  frameDriver: FrameDriver;
  pool: PageBufferPool;
  contentRenderer: ContentRenderer;
  /** Invalidates older async position work as soon as a navigation intent is accepted. */
  onNavigationIntent?: () => void;
  /** Supersedes pending content interactions for every accepted navigation/position intent. */
  onContentInteractionIntent?: () => void;
  onNavigationCancelled?: () => void;
  /** Publishes a newly committed known/final spread extent without resetting layout state. */
  onPaginationChanged?: () => void;
}

export interface NavigationActions {
  goToSpread(index: number): void;
  startGestureNavigation(
    index: number,
    onTransitionStart: () => void,
    onUnavailable?: () => void,
  ): GestureNavigationToken;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;
  /** Grow and navigate to a durable locator under the shared latest-wins navigation owner. */
  navigateToLocator(locator: ReaderLocator): void;
  /** Snap to a spread without playing a transition animation. */
  jumpToSpread(index: number, preservePositionIntent?: boolean): boolean;
  /** Snap only when the target is immediately paintable. */
  jumpToSpreadIfReady(index: number): NavigationJumpOutcome;
  /** Continue a deferred navigation once its async content slot is ready. */
  notifyContentReady(spreadIndex: number): void;
  /** Retry a TOC target that was unavailable in a partial preview revision. */
  notifyLayoutCommitted(): void;
  supersedeForPositionIntent(): void;
  dispose(): void;
}

/** Cancels a gesture navigation only while it is still waiting for content. */
export interface GestureNavigationToken {
  cancel(): void;
}

export function createNavigation(deps: NavigationDeps): NavigationActions {
  const state = createNavigationState();
  const locatorNavigator = createLocatorNavigator(state, deps);
  return {
    goToSpread(index) {
      startNavigation(state, deps, index);
    },
    startGestureNavigation(index, onTransitionStart, onUnavailable) {
      return startGestureNavigation(state, deps, index, onTransitionStart, onUnavailable);
    },
    nextSpread() {
      startNavigation(state, deps, deps.getCurrentSpread() + 1);
    },
    prevSpread() {
      startNavigation(state, deps, deps.getCurrentSpread() - 1);
    },
    navigateToTocEntry(entry) {
      navigateTocEntry(state, deps, entry, locatorNavigator);
    },
    navigateToLocator(locator) {
      navigateReaderLocator(state, deps, locator, locatorNavigator);
    },
    jumpToSpread(index, preservePositionIntent) {
      if (state.disposed) return false;
      const attemptId = claimNavigationAttempt(state, deps, preservePositionIntent);
      return jumpToSpread(state, deps, attemptId, index);
    },
    jumpToSpreadIfReady(index) {
      if (state.disposed) return 'superseded';
      const attemptId = claimNavigationAttempt(state, deps);
      return jumpToSpreadIfReady(state, deps, attemptId, index);
    },
    notifyContentReady(spreadIndex) {
      if (state.disposed) return;
      continuePendingNavigation(state, deps, spreadIndex);
    },
    notifyLayoutCommitted() {
      if (state.disposed) return;
      retryPendingTocEntry(state, deps, locatorNavigator);
    },
    supersedeForPositionIntent: () => {
      if (state.disposed) return;
      deps.onContentInteractionIntent?.();
      supersedeNavigationForPositionIntent(state, deps.td);
    },
    dispose() {
      disposeNavigation(state);
    },
  };
}

function disposeNavigation(state: NavigationState): void {
  if (state.disposed) return;
  state.disposed = true;
  state.navigationAttemptId += 1;
  clearPendingNavigation(state);
}

function createLocatorNavigator(
  state: NavigationState,
  deps: NavigationDeps,
): (spreadIndex: number) => void {
  return (spreadIndex): void => {
    replaceWithNavigation(state, deps, goToSpread(state, deps, spreadIndex));
  };
}

function startNavigation(state: NavigationState, deps: NavigationDeps, index: number): void {
  replaceWithNavigation(state, deps, goToSpread(state, deps, index));
}

function startGestureNavigation(
  state: NavigationState,
  deps: NavigationDeps,
  index: number,
  onTransitionStart: () => void,
  onUnavailable?: () => void,
): GestureNavigationToken {
  if (state.disposed) {
    onUnavailable?.();
    return { cancel() {} };
  }
  const request: GestureNavigationRequest = {
    onTransitionStart,
    ...(onUnavailable ? { onUnavailable } : {}),
    started: false,
    cancelled: false,
  };
  replaceWithNavigation(state, deps, goToSpread(state, deps, index, request));
  return {
    cancel(): void {
      if (request.started) return;
      request.cancelled = true;
      if (state.pendingNavigation?.gesture === request) {
        state.navigationAttemptId += 1;
        clearPendingNavigation(state);
        deps.onNavigationCancelled?.();
      }
    },
  };
}

function goToSpread(
  state: NavigationState,
  deps: NavigationDeps,
  index: number,
  gesture?: GestureNavigationRequest,
): NavigationAttempt {
  const initialReader = deps.getReader();
  if (state.disposed || !initialReader) return { claimedIntent: false };
  const initialTarget = navigationTarget(initialReader, index);
  const initialPrevious = deps.getCurrentSpread();
  const attemptId = claimNavigationAttempt(state, deps);
  if (attemptId !== state.navigationAttemptId) return { claimedIntent: true, attemptId };
  if (initialTarget.index === initialPrevious && !initialTarget.pagination) {
    return completeNoOpNavigation(deps, attemptId, gesture);
  }

  const continuityDx = deps.td.isAnimating ? settleNavigationForContinuity(deps.td) : 0;
  const previous = deps.getCurrentSpread();
  if (attemptId !== state.navigationAttemptId) return { claimedIntent: true, attemptId };
  const reader = deps.getReader();
  if (!reader) return { claimedIntent: true, attemptId };
  const target = navigationTarget(reader, index);
  if (target.index === previous && !target.pagination) {
    return completeNoOpNavigation(deps, attemptId, gesture);
  }

  if (target.pagination) {
    return createSpreadGrowthAttempt(
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

function createKnownSpreadAttempt(
  state: NavigationState,
  deps: NavigationDeps,
  reader: Reader,
  attemptId: number,
  target: number,
  previous: number,
  continuityDx: number,
  gesture?: GestureNavigationRequest,
): NavigationAttempt {
  const direction = target > previous ? 'forward' : 'backward';
  if (!ensureIncomingSlot(deps, target, direction)) {
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
  gesture?: GestureNavigationRequest,
): NavigationAttempt {
  if (gesture && !gesture.started) {
    gesture.cancelled = true;
    gesture.onUnavailable?.();
  }
  deps.onNavigationCancelled?.();
  return { claimedIntent: true, attemptId };
}

function replaceWithNavigation(
  state: NavigationState,
  deps: NavigationDeps,
  attempt: NavigationAttempt,
): void {
  if (!attempt.claimedIntent) {
    const cancelledIntent = clearPendingNavigation(state);
    if (cancelledIntent) {
      state.navigationAttemptId += 1;
      deps.onNavigationCancelled?.();
    }
    return;
  }
  if (attempt.attemptId !== state.navigationAttemptId) return;
  state.pendingNavigation = attempt.pendingNavigation;
}
