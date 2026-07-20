import type { SettledEvent } from '../../driver/types';
import {
  finishChapterLocalLease,
  ownedPendingLocator,
  type ResolvedLocator,
} from './chapter-local-preview-shared';
import {
  settleChapterLocalIncoming,
  settleChapterLocalRollback,
  promoteChapterLocalExact,
  startChapterLocalTermination,
} from './chapter-local-preview-settle';
import {
  queueChapterLocalPreviewInvalidation,
  resumeQueuedChapterLocalNavigation,
  startChapterLocalPresentation,
} from './chapter-local-preview-start';
import {
  fatalChapterLocalContainment,
  releaseProvisionalForTerminalMutation,
  resumeAllQueuedNavigation,
  safelyDriveActiveChapterLocal,
  tryCompleteExactFallback,
  tryFinishRestoredMount,
} from './chapter-local-preview-terminal';
import type { NavigationDeps } from './index';
import type { NavigationState, PendingLocatorNavigation } from './state';

export { resumeQueuedChapterLocalNavigation };

export function presentChapterLocalInvalidation(
  state: NavigationState,
  deps: NavigationDeps,
  spreadIndex: number,
): boolean {
  if (state.disposed || spreadIndex !== deps.getCurrentSpread()) return false;
  if (state.finalizingChapterLocalTransition) {
    return queueChapterLocalPreviewInvalidation(state, deps, spreadIndex);
  }
  const active = state.activeChapterLocalTransition;
  if (active) {
    if (spreadIndex !== active.mountSpreadIndex) return false;
    active.mountExactPaintRequired = true;
    active.mountExactInvalidated = false;
    const queued = ownedPendingLocator(state);
    if (queued && queued !== active.pending) queued.previewReadySpread = spreadIndex;
    if (active.phase === 'restoringExact' || active.phase === 'awaitingExactFallback') {
      safelyDriveActiveChapterLocal(state, deps, active, () => {
        tryFinishRestoredMount(state, deps, active);
      });
    } else if (active.phase === 'committed' && active.pending.exactResolution) {
      safelyDriveActiveChapterLocal(state, deps, active, () => {
        promoteChapterLocalExact(state, deps, active);
      });
    }
    return true;
  }
  const pending = ownedPendingLocator(state);
  if (!pending || pending.provisionalPhase !== 'none') return false;
  if (deps.td.isAnimating) {
    return queueChapterLocalPreviewInvalidation(state, deps, spreadIndex);
  }
  return startChapterLocalPresentation(state, deps, pending, spreadIndex);
}

export function settleChapterLocalExact(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  resolution: ResolvedLocator,
): boolean {
  const active = state.activeChapterLocalTransition;
  if (active?.pending === pending) {
    pending.exactResolution = resolution;
    if (active.phase === 'committed') {
      safelyDriveActiveChapterLocal(state, deps, active, () => {
        promoteChapterLocalExact(state, deps, active);
      });
    } else if (active.phase === 'awaitingExactFallback') {
      safelyDriveActiveChapterLocal(state, deps, active, () => {
        tryCompleteExactFallback(state, deps, active);
      });
    }
    return true;
  }
  if (active) {
    pending.exactResolution = resolution;
    return true;
  }
  if (pending.previewReadySpread !== undefined) {
    if (deps.td.isAnimating || state.finalizingChapterLocalTransition) {
      pending.exactResolution = resolution;
      return true;
    }
    pending.previewReadySpread = undefined;
  }
  return false;
}

export function failChapterLocalLocator(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error?: unknown,
): boolean {
  const active = state.activeChapterLocalTransition;
  if (!active || active.pending !== pending) return false;
  active.termination =
    error === undefined
      ? { kind: 'cancelled' }
      : { kind: 'failed', error, failureSource: pending.failureSource };
  safelyDriveActiveChapterLocal(state, deps, active, () => {
    startChapterLocalTermination(state, deps, active);
  });
  return true;
}

export function supersedeChapterLocalTransition(
  state: NavigationState,
  deps: NavigationDeps,
): boolean {
  const active = state.activeChapterLocalTransition;
  if (!active) return false;
  active.termination = { kind: 'superseded' };
  safelyDriveActiveChapterLocal(state, deps, active, () => {
    startChapterLocalTermination(state, deps, active);
  });
  return true;
}

export function handleChapterLocalTransitionSettled(
  state: NavigationState,
  deps: NavigationDeps,
  event: SettledEvent,
): boolean {
  const active = state.activeChapterLocalTransition;
  if (!active) {
    queueMicrotask(() => {
      resumeQueuedChapterLocalNavigation(state, deps);
    });
    return false;
  }
  try {
    if (active.phase === 'animating') {
      return settleChapterLocalIncoming(state, deps, active, event);
    }
    if (active.phase === 'rollingBack') {
      return settleChapterLocalRollback(state, deps, active, event);
    }
    fatalChapterLocalContainment(
      state,
      deps,
      active,
      active.phase === 'committed'
        ? 'unexpected transition while a committed preview owns the current raster'
        : 'unexpected transition while restoring exact content',
    );
    return true;
  } catch (error) {
    if (state.activeChapterLocalTransition === active) {
      fatalChapterLocalContainment(
        state,
        deps,
        active,
        error instanceof Error ? error.message : 'chapter-local settle failed',
      );
    }
    return true;
  }
}

export function disposeChapterLocalTransition(state: NavigationState, deps: NavigationDeps): void {
  const active = state.activeChapterLocalTransition;
  if (!active) return;
  releaseProvisionalForTerminalMutation(deps, active);
  finishChapterLocalLease(active);
  state.activeChapterLocalTransition = undefined;
  deps.provisionalRuntime?.cancel(active.direction);
}

export function terminateChapterLocalTransitionForLayout(
  state: NavigationState,
  deps: NavigationDeps,
): (() => void) | undefined {
  const active = state.activeChapterLocalTransition;
  if (!active) return undefined;
  deps.td.reset();
  releaseProvisionalForTerminalMutation(deps, active);
  finishChapterLocalLease(active);
  state.activeChapterLocalTransition = undefined;
  if (state.pendingLocatorNavigation === active.pending) {
    state.pendingLocatorNavigation = undefined;
    active.pending.locatorAbort.abort();
  }
  const finishRuntime = deps.provisionalRuntime?.deferForLayout(active.direction);
  state.finalizingChapterLocalTransition = true;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    try {
      finishRuntime?.();
    } finally {
      state.finalizingChapterLocalTransition = false;
      resumeAllQueuedNavigation(state, deps);
    }
  };
}

export function refreshChapterLocalTransitionTheme(
  state: NavigationState,
  deps: NavigationDeps,
): void {
  const active = state.activeChapterLocalTransition;
  if (!active) return;
  active.mountExactPaintRequired = true;
  if (active.phase === 'restoringExact' || active.phase === 'awaitingExactFallback') {
    active.mountExactInvalidated = false;
    safelyDriveActiveChapterLocal(state, deps, active, () => {
      tryFinishRestoredMount(state, deps, active);
    });
    return;
  }
  let refreshed = false;
  let failure: unknown;
  try {
    refreshed = deps.pool.refreshProvisionalStage(active.stageToken, (context) =>
      active.lease.render(context),
    );
  } catch (error) {
    failure = error;
  }
  if (refreshed) return;
  if (!active.termination) {
    active.termination = {
      kind: 'failed',
      error: failure ?? new Error('Reader could not repaint the chapter-local preview'),
      failureSource: 'reader chapter-local presentation',
      fallbackToExact: true,
    };
  }
  safelyDriveActiveChapterLocal(state, deps, active, () => {
    startChapterLocalTermination(state, deps, active);
  });
}

export function notifyChapterLocalContentReady(
  state: NavigationState,
  deps: NavigationDeps,
  spreadIndex: number,
): boolean {
  const active = state.activeChapterLocalTransition;
  if (!active) return false;
  if (
    (active.phase === 'restoringExact' || active.phase === 'awaitingExactFallback') &&
    active.mountSpreadIndex === spreadIndex
  ) {
    safelyDriveActiveChapterLocal(state, deps, active, () => {
      tryFinishRestoredMount(state, deps, active);
    });
    return true;
  }
  if (
    active.phase === 'awaitingExactFallback' &&
    active.pending.exactResolution?.spreadIndex === spreadIndex
  ) {
    safelyDriveActiveChapterLocal(state, deps, active, () => {
      tryCompleteExactFallback(state, deps, active);
    });
    return true;
  }
  if (active.phase !== 'committed') return false;
  if (active.pending.exactResolution?.spreadIndex !== spreadIndex) return false;
  safelyDriveActiveChapterLocal(state, deps, active, () => {
    promoteChapterLocalExact(state, deps, active);
  });
  return true;
}
