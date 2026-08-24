import {
  canClaimChapterLocalPresentation,
  claimChapterLocalPresentation,
} from './chapter-local-capability';
import type { NavigationDeps } from './index';
import type { ProvisionalTransitionRuntime } from '../runtime-frame';
import { ownedPendingLocator, ownsPendingLocator } from './chapter-local-preview-shared';
import type {
  ActiveChapterLocalTransition,
  ChapterLocalPresentationLease,
  NavigationState,
  PendingLocatorNavigation,
} from './state';
import { continueResolvedLocatorNavigation } from './locator-continuation';

interface PresentationStartProgress {
  token: number | undefined;
  runtimeBegan: boolean;
  transitionStarted: boolean;
}

export function startChapterLocalPresentation(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  spreadIndex: number,
): boolean {
  const reader = deps.getReader();
  const runtime = deps.provisionalRuntime;
  if (!reader || !runtime || !ownsPendingLocator(state, pending) || deps.td.isAnimating) {
    return false;
  }
  const lease = claimChapterLocalPresentation(reader, pending.locator, spreadIndex);
  if (!lease) return false;
  const progress: PresentationStartProgress = {
    token: undefined,
    runtimeBegan: false,
    transitionStarted: false,
  };
  try {
    return installPresentationStart(state, deps, pending, spreadIndex, lease, runtime, progress);
  } catch (error) {
    containPresentationStartFailure(
      state,
      deps,
      pending,
      spreadIndex,
      lease,
      runtime,
      progress,
      error,
    );
    return false;
  }
}

function installPresentationStart(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  spreadIndex: number,
  lease: ChapterLocalPresentationLease,
  runtime: ProvisionalTransitionRuntime,
  progress: PresentationStartProgress,
): boolean {
  const stage = deps.pool.beginProvisionalStage(spreadIndex, lease.direction, () => {
    lease.composited();
  });
  progress.token = stage.token;
  if (!deps.pool.ensureProvisionalStage(stage.token, (context) => lease.render(context))) {
    deps.pool.cancelProvisionalStage(stage.token);
    lease.finish();
    return false;
  }
  state.activeChapterLocalTransition = createActiveTransition(
    pending,
    spreadIndex,
    stage.token,
    lease,
  );
  pending.provisionalPhase = 'animating';
  pending.previewReadySpread = undefined;
  runtime.begin(lease.direction);
  progress.runtimeBegan = true;
  deps.td.goToTarget(lease.direction, spreadIndex, spreadIndex);
  progress.transitionStarted = true;
  deps.emitter.emit('transitionStart', { direction: lease.direction });
  deps.frameDriver.scheduleComposite();
  return true;
}

function createActiveTransition(
  pending: PendingLocatorNavigation,
  spreadIndex: number,
  stageToken: number,
  lease: ChapterLocalPresentationLease,
): ActiveChapterLocalTransition {
  return {
    attemptId: pending.attemptId,
    pending,
    mountSpreadIndex: spreadIndex,
    direction: lease.direction,
    stageToken,
    lease,
    phase: 'animating',
    visualTransitionSettled: false,
    leaseFinished: false,
    exactPublished: false,
    mountExactPaintRequired: false,
    mountExactInvalidated: false,
    termination: undefined,
  };
}

function containPresentationStartFailure(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  spreadIndex: number,
  lease: ChapterLocalPresentationLease,
  runtime: ProvisionalTransitionRuntime,
  progress: PresentationStartProgress,
  error: unknown,
): void {
  const ownsActive = state.activeChapterLocalTransition?.pending === pending;
  if (ownsActive && progress.transitionStarted) deps.td.reset();
  releaseFailedStage(
    deps,
    progress.token,
    spreadIndex,
    ownsActive || state.activeChapterLocalTransition === undefined,
  );
  if (ownsActive) state.activeChapterLocalTransition = undefined;
  pending.provisionalPhase = 'none';
  finishFailedStartLease(lease);
  releaseFailedStartRuntime(runtime, lease, progress, ownsActive);
  deps.frameDriver.scheduleComposite();
  reportPresentationStartFailure(deps, error);
}

function finishFailedStartLease(lease: ChapterLocalPresentationLease): void {
  try {
    lease.finish();
  } catch {
    // Pool/runtime ownership is terminal independently of the host callback.
  }
}

function releaseFailedStartRuntime(
  runtime: ProvisionalTransitionRuntime,
  lease: ChapterLocalPresentationLease,
  progress: PresentationStartProgress,
  ownsActive: boolean,
): void {
  if (!ownsActive || !progress.runtimeBegan) return;
  try {
    if (progress.transitionStarted) runtime.complete(lease.direction);
    else runtime.cancel(lease.direction);
  } catch {
    // Listener failures cannot retain the provisional runtime owner.
  }
}

function reportPresentationStartFailure(deps: NavigationDeps, error: unknown): void {
  try {
    deps.emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source: 'reader chapter-local presentation',
    });
  } catch {
    // The presentation is already terminal; do not resurrect it for reporting.
  }
}

export function resumeQueuedChapterLocalNavigation(
  state: NavigationState,
  deps: NavigationDeps,
): void {
  if (
    state.disposed ||
    state.activeChapterLocalTransition ||
    state.finalizingChapterLocalTransition ||
    deps.td.isAnimating
  ) {
    return;
  }
  const pending = ownedPendingLocator(state);
  if (!pending) return;
  if (pending.exactResolution) {
    continueResolvedLocatorNavigation(state, deps, pending, pending.exactResolution.spreadIndex);
    return;
  }
  if (pending.previewReadySpread !== undefined) {
    const spreadIndex = pending.previewReadySpread;
    pending.previewReadySpread = undefined;
    startChapterLocalPresentation(state, deps, pending, spreadIndex);
  }
}

export function queueChapterLocalPreviewInvalidation(
  state: NavigationState,
  deps: NavigationDeps,
  spreadIndex: number,
): boolean {
  const pending = ownedPendingLocator(state);
  const reader = deps.getReader();
  if (
    !pending ||
    !reader ||
    !canClaimChapterLocalPresentation(reader, pending.locator, spreadIndex)
  ) {
    return false;
  }
  pending.previewReadySpread = spreadIndex;
  // The signal is also an ordinary resource invalidation. Keep the exact slot
  // dirty even when the provisional claim is queued or later disappears.
  deps.pool.invalidateContentForSpread(spreadIndex);
  deps.frameDriver.scheduleComposite();
  return true;
}

function releaseFailedStage(
  deps: NavigationDeps,
  token: number | undefined,
  spreadIndex: number,
  canReset: boolean,
): void {
  if (token === undefined) return;
  try {
    if (!deps.pool.cancelProvisionalStage(token) && canReset) {
      deps.pool.resetProvisionalState(spreadIndex);
    }
  } catch {
    if (!canReset) return;
    try {
      deps.pool.resetProvisionalState(spreadIndex);
    } catch {
      // Runtime ownership is still released by the caller.
    }
  }
}
