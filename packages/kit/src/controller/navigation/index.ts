import type { Reader, TocEntry } from '@ritojs/core';
import type { FrameDriver } from '../../driver/frame-driver';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../../painter/buffer-pool';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { ReaderControllerEvents } from '../types';
import {
  clearPendingNavigation,
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
import { emitNavigationStart } from './start';

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
  onNavigationCancelled?: () => void;
}

export interface NavigationActions {
  goToSpread(index: number): void;
  startGestureNavigation(index: number, onTransitionStart: () => void): GestureNavigationToken;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;
  /** Snap to a spread without playing a transition animation. */
  jumpToSpread(index: number, preservePositionIntent?: boolean): boolean;
  /** Snap only when the target is immediately paintable. */
  jumpToSpreadIfReady(index: number): NavigationJumpOutcome;
  /** Continue a deferred navigation once its async content slot is ready. */
  notifyContentReady(spreadIndex: number): void;
  /** Retry a TOC target that was unavailable in a partial preview revision. */
  notifyLayoutCommitted(): void;
  supersedeForPositionIntent(): void;
}

/** Cancels a gesture navigation only while it is still waiting for content. */
export interface GestureNavigationToken {
  cancel(): void;
}

export function createNavigation(deps: NavigationDeps): NavigationActions {
  const state: NavigationState = {
    navigationAttemptId: 0,
    pendingNavigation: undefined,
    pendingTocEntry: undefined,
  };
  return {
    goToSpread(index) {
      startNavigation(state, deps, index);
    },
    startGestureNavigation(index, onTransitionStart) {
      return startGestureNavigation(state, deps, index, onTransitionStart);
    },
    nextSpread() {
      startNavigation(state, deps, deps.getCurrentSpread() + 1);
    },
    prevSpread() {
      startNavigation(state, deps, deps.getCurrentSpread() - 1);
    },
    navigateToTocEntry(entry) {
      navigateToTocEntry(state, deps, entry);
    },
    jumpToSpread(index, preservePositionIntent) {
      const attemptId = claimNavigationAttempt(state, deps, preservePositionIntent);
      return jumpToSpread(state, deps, attemptId, index);
    },
    jumpToSpreadIfReady(index) {
      const attemptId = claimNavigationAttempt(state, deps);
      return jumpToSpreadIfReady(state, deps, attemptId, index);
    },
    notifyContentReady(spreadIndex) {
      continuePendingNavigation(state, deps, spreadIndex);
    },
    notifyLayoutCommitted() {
      retryPendingTocNavigation(state, deps);
    },
    supersedeForPositionIntent: () => {
      supersedeNavigationForPositionIntent(state, deps.td);
    },
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
): GestureNavigationToken {
  const request: GestureNavigationRequest = {
    onTransitionStart,
    started: false,
    cancelled: false,
  };
  replaceWithNavigation(state, deps, goToSpread(state, deps, index, request));
  return {
    cancel(): void {
      if (request.started) return;
      request.cancelled = true;
      if (state.pendingNavigation?.gesture === request) {
        state.pendingNavigation = undefined;
        state.navigationAttemptId += 1;
        deps.onNavigationCancelled?.();
      }
    },
  };
}

function navigateToTocEntry(state: NavigationState, deps: NavigationDeps, entry: TocEntry): void {
  const resolved = deps.getReader()?.resolveTocEntry(entry);
  if (!resolved) {
    state.navigationAttemptId += 1;
    clearPendingNavigation(state);
    deps.onNavigationIntent?.();
    state.pendingTocEntry = entry;
    return;
  }
  replaceWithNavigation(state, deps, goToSpread(state, deps, resolved.spreadIndex));
}

function retryPendingTocNavigation(state: NavigationState, deps: NavigationDeps): void {
  const entry = state.pendingTocEntry;
  if (!entry) return;
  const resolved = deps.getReader()?.resolveTocEntry(entry);
  if (!resolved) return;
  replaceWithNavigation(state, deps, goToSpread(state, deps, resolved.spreadIndex));
}

function continuePendingNavigation(
  state: NavigationState,
  deps: NavigationDeps,
  spreadIndex: number,
): void {
  const pending = state.pendingNavigation;
  if (!pending || pending.target !== spreadIndex) return;
  if (pending.attemptId !== state.navigationAttemptId) return;
  if (pending.gesture?.cancelled) {
    state.pendingNavigation = undefined;
    return;
  }
  if (!ensureIncomingSlot(deps, pending.target, pending.direction)) return;
  const reader = deps.getReader();
  if (!reader) return;
  state.pendingNavigation = undefined;
  emitNavigationStart(
    state,
    deps,
    reader,
    pending.attemptId,
    pending.target,
    pending.direction,
    pending.previous,
    pending.continuityDx,
    pending.gesture,
  );
}

function goToSpread(
  state: NavigationState,
  deps: NavigationDeps,
  index: number,
  gesture?: GestureNavigationRequest,
): NavigationAttempt {
  const reader = deps.getReader();
  if (!reader) return { claimedIntent: false };
  const clamped = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  let previous = deps.getCurrentSpread();
  const attemptId = claimNavigationAttempt(state, deps);
  if (attemptId !== state.navigationAttemptId) return { claimedIntent: true, attemptId };
  if (clamped === previous) return completeNoOpNavigation(deps, attemptId);

  const continuityDx = deps.td.isAnimating ? settleNavigationForContinuity(deps.td) : 0;
  previous = deps.getCurrentSpread();
  if (attemptId !== state.navigationAttemptId) return { claimedIntent: true, attemptId };
  if (clamped === previous) return completeNoOpNavigation(deps, attemptId);

  const direction = clamped > previous ? 'forward' : 'backward';
  if (!ensureIncomingSlot(deps, clamped, direction)) {
    deps.frameDriver.scheduleComposite();
    return {
      claimedIntent: true,
      attemptId,
      pendingNavigation: {
        attemptId,
        target: clamped,
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
    clamped,
    direction,
    previous,
    continuityDx,
    gesture,
  );
  return { claimedIntent: true, attemptId };
}

function completeNoOpNavigation(deps: NavigationDeps, attemptId: number): NavigationAttempt {
  deps.onNavigationCancelled?.();
  return { claimedIntent: true, attemptId };
}

function ensureIncomingSlot(
  deps: NavigationDeps,
  spreadIndex: number,
  direction: 'forward' | 'backward',
): boolean {
  const slotPosition = direction === 'forward' ? 'next' : 'prev';
  if (deps.pool.getSlotFor(spreadIndex) !== slotPosition) {
    deps.pool.assignSlot(slotPosition, spreadIndex);
  }
  return deps.pool.ensureContent(slotPosition, deps.contentRenderer);
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
