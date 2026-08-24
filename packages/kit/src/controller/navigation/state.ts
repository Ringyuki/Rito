import type {
  ReaderIncrementalPagination,
  ReaderLocator,
  ReaderLocatorResolution,
  TocEntry,
} from '@ritojs/core';
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
  readonly onResolved: (spreadIndex: number) => void;
  provisionalPhase: 'none' | 'animating' | 'committed';
  previewReadySpread: number | undefined;
  exactResolution: Extract<ReaderLocatorResolution, { readonly status: 'resolved' }> | undefined;
}

export interface ChapterLocalPresentationLease {
  readonly direction: 'forward' | 'backward';
  render(context: OffscreenCanvasRenderingContext2D): boolean;
  composited(): boolean;
  transitionSettled(): boolean;
  finish(): boolean;
}

export interface ChapterLocalTermination {
  readonly kind: 'cancelled' | 'failed' | 'superseded';
  readonly error?: unknown;
  readonly failureSource?: string;
  readonly fallbackToExact?: boolean;
}

export interface ActiveChapterLocalTransition {
  readonly attemptId: number;
  readonly pending: PendingLocatorNavigation;
  readonly mountSpreadIndex: number;
  readonly direction: 'forward' | 'backward';
  readonly stageToken: number;
  readonly lease: ChapterLocalPresentationLease;
  phase: 'animating' | 'committed' | 'rollingBack' | 'restoringExact' | 'awaitingExactFallback';
  visualTransitionSettled: boolean;
  leaseFinished: boolean;
  exactPublished: boolean;
  mountExactPaintRequired: boolean;
  mountExactInvalidated: boolean;
  termination: ChapterLocalTermination | undefined;
}

export interface NavigationState {
  navigationAttemptId: number;
  zeroContinuityAttemptId: number | undefined;
  pendingNavigation: PendingNavigation | undefined;
  pendingTocNavigation: PendingTocNavigation | undefined;
  pendingLocatorNavigation: PendingLocatorNavigation | undefined;
  activeChapterLocalTransition: ActiveChapterLocalTransition | undefined;
  finalizingChapterLocalTransition: boolean;
  disposed: boolean;
}

export function createNavigationState(): NavigationState {
  return {
    navigationAttemptId: 0,
    zeroContinuityAttemptId: undefined,
    pendingNavigation: undefined,
    pendingTocNavigation: undefined,
    pendingLocatorNavigation: undefined,
    activeChapterLocalTransition: undefined,
    finalizingChapterLocalTransition: false,
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

/** Finish a superseded provisional rollback without carrying its displacement into a new intent. */
export function settleNavigationAttemptForContinuity(
  state: NavigationState,
  transition: TransitionDriver,
  attemptId: number,
): number {
  if (state.zeroContinuityAttemptId !== attemptId) {
    return settleNavigationForContinuity(transition);
  }
  state.zeroContinuityAttemptId = undefined;
  transition.forceSettle();
  return 0;
}
