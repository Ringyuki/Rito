import {
  activeLocalPreview,
  beginLocalFinalizing,
  dismissLocalPreview,
  endLocalFinalizing,
  enqueueIntent,
  queuedLocatorSeek,
} from '../machine';
import type { NavigationMachine, PendingLocatorNavigation } from '../machine';
import type { SettledEvent } from '../../../driver/types';
import { finishChapterLocalLease, ownedPendingLocator, type ResolvedLocator } from './shared';
import {
  settleChapterLocalIncoming,
  settleChapterLocalRollback,
  promoteChapterLocalExact,
  startChapterLocalTermination,
} from './settle';
import {
  queueChapterLocalPreviewInvalidation,
  resumeQueuedChapterLocalNavigation,
  startChapterLocalPresentation,
} from './start';
import {
  fatalChapterLocalContainment,
  releaseProvisionalForTerminalMutation,
  resumeAllQueuedNavigation,
  safelyDriveActiveChapterLocal,
  tryCompleteExactFallback,
  tryFinishRestoredMount,
} from './terminal';
import type { NavigationDeps } from '../index';

export { resumeQueuedChapterLocalNavigation };

export function presentChapterLocalInvalidation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  spreadIndex: number,
): boolean {
  if (machine.disposed || spreadIndex !== deps.getCurrentSpread()) return false;
  if (machine.foreground.kind === 'local-finalizing') {
    return queueChapterLocalPreviewInvalidation(machine, deps, spreadIndex);
  }
  const active = activeLocalPreview(machine);
  if (active) {
    if (spreadIndex !== active.mountSpreadIndex) return false;
    active.mountExactPaintRequired = true;
    active.mountExactInvalidated = false;
    const queued = ownedPendingLocator(machine);
    if (queued && queued !== active.pending) queued.previewReadySpread = spreadIndex;
    if (active.phase === 'restoringExact' || active.phase === 'awaitingExactFallback') {
      safelyDriveActiveChapterLocal(machine, deps, active, () => {
        tryFinishRestoredMount(machine, deps, active);
      });
    } else if (active.phase === 'committed' && active.pending.exactResolution) {
      safelyDriveActiveChapterLocal(machine, deps, active, () => {
        promoteChapterLocalExact(machine, deps, active);
      });
    }
    return true;
  }
  const pending = ownedPendingLocator(machine);
  if (!pending || pending.provisionalPhase !== 'none') return false;
  if (deps.td.isAnimating) {
    return queueChapterLocalPreviewInvalidation(machine, deps, spreadIndex);
  }
  return startChapterLocalPresentation(machine, deps, pending, spreadIndex);
}

export function settleChapterLocalExact(
  machine: NavigationMachine,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  resolution: ResolvedLocator,
): boolean {
  const active = activeLocalPreview(machine);
  if (active?.pending === pending) {
    pending.exactResolution = resolution;
    if (active.phase === 'committed') {
      safelyDriveActiveChapterLocal(machine, deps, active, () => {
        promoteChapterLocalExact(machine, deps, active);
      });
    } else if (active.phase === 'awaitingExactFallback') {
      safelyDriveActiveChapterLocal(machine, deps, active, () => {
        tryCompleteExactFallback(machine, deps, active);
      });
    }
    return true;
  }
  if (active) {
    pending.exactResolution = resolution;
    return true;
  }
  if (pending.previewReadySpread !== undefined) {
    if (deps.td.isAnimating || machine.foreground.kind === 'local-finalizing') {
      pending.exactResolution = resolution;
      return true;
    }
    pending.previewReadySpread = undefined;
  }
  return false;
}

export function failChapterLocalLocator(
  machine: NavigationMachine,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error?: unknown,
): boolean {
  const active = activeLocalPreview(machine);
  if (!active || active.pending !== pending) return false;
  active.termination =
    error === undefined
      ? { kind: 'cancelled' }
      : { kind: 'failed', error, failureSource: pending.failureSource };
  safelyDriveActiveChapterLocal(machine, deps, active, () => {
    startChapterLocalTermination(machine, deps, active);
  });
  return true;
}

export function supersedeLocalPreview(machine: NavigationMachine, deps: NavigationDeps): boolean {
  const active = activeLocalPreview(machine);
  if (!active) return false;
  active.termination = { kind: 'superseded' };
  safelyDriveActiveChapterLocal(machine, deps, active, () => {
    startChapterLocalTermination(machine, deps, active);
  });
  return true;
}

export function handleChapterLocalTransitionSettled(
  machine: NavigationMachine,
  deps: NavigationDeps,
  event: SettledEvent,
): boolean {
  const active = activeLocalPreview(machine);
  if (!active) {
    queueMicrotask(() => {
      resumeQueuedChapterLocalNavigation(machine, deps);
    });
    return false;
  }
  try {
    if (active.phase === 'animating') {
      return settleChapterLocalIncoming(machine, deps, active, event);
    }
    if (active.phase === 'rollingBack') {
      return settleChapterLocalRollback(machine, deps, active, event);
    }
    fatalChapterLocalContainment(
      machine,
      deps,
      active,
      active.phase === 'committed'
        ? 'unexpected transition while a committed preview owns the current raster'
        : 'unexpected transition while restoring exact content',
    );
    return true;
  } catch (error) {
    if (activeLocalPreview(machine) === active) {
      fatalChapterLocalContainment(
        machine,
        deps,
        active,
        error instanceof Error ? error.message : 'chapter-local settle failed',
      );
    }
    return true;
  }
}

export function disposeChapterLocalTransition(
  machine: NavigationMachine,
  deps: NavigationDeps,
): void {
  const active = activeLocalPreview(machine);
  if (!active) return;
  releaseProvisionalForTerminalMutation(deps, active);
  finishChapterLocalLease(active);
  dismissLocalPreview(machine);
  deps.provisionalRuntime?.cancel(active.direction);
}

export function terminateChapterLocalTransitionForLayout(
  machine: NavigationMachine,
  deps: NavigationDeps,
): (() => void) | undefined {
  const active = activeLocalPreview(machine);
  if (!active) return undefined;
  deps.td.reset();
  releaseProvisionalForTerminalMutation(deps, active);
  finishChapterLocalLease(active);
  dismissLocalPreview(machine);
  if (queuedLocatorSeek(machine) === active.pending) {
    enqueueIntent(machine, undefined);
    active.pending.locatorAbort.abort();
  }
  const finishRuntime = deps.provisionalRuntime?.deferForLayout(active.direction);
  beginLocalFinalizing(machine);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    try {
      finishRuntime?.();
    } finally {
      endLocalFinalizing(machine);
      resumeAllQueuedNavigation(machine, deps);
    }
  };
}

export function refreshChapterLocalTransitionTheme(
  machine: NavigationMachine,
  deps: NavigationDeps,
): void {
  const active = activeLocalPreview(machine);
  if (!active) return;
  active.mountExactPaintRequired = true;
  if (active.phase === 'restoringExact' || active.phase === 'awaitingExactFallback') {
    active.mountExactInvalidated = false;
    safelyDriveActiveChapterLocal(machine, deps, active, () => {
      tryFinishRestoredMount(machine, deps, active);
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
  safelyDriveActiveChapterLocal(machine, deps, active, () => {
    startChapterLocalTermination(machine, deps, active);
  });
}

export function notifyChapterLocalContentReady(
  machine: NavigationMachine,
  deps: NavigationDeps,
  spreadIndex: number,
): boolean {
  const active = activeLocalPreview(machine);
  if (!active) return false;
  if (
    (active.phase === 'restoringExact' || active.phase === 'awaitingExactFallback') &&
    active.mountSpreadIndex === spreadIndex
  ) {
    safelyDriveActiveChapterLocal(machine, deps, active, () => {
      tryFinishRestoredMount(machine, deps, active);
    });
    return true;
  }
  if (
    active.phase === 'awaitingExactFallback' &&
    active.pending.exactResolution?.spreadIndex === spreadIndex
  ) {
    safelyDriveActiveChapterLocal(machine, deps, active, () => {
      tryCompleteExactFallback(machine, deps, active);
    });
    return true;
  }
  if (active.phase !== 'committed') return false;
  if (active.pending.exactResolution?.spreadIndex !== spreadIndex) return false;
  safelyDriveActiveChapterLocal(machine, deps, active, () => {
    promoteChapterLocalExact(machine, deps, active);
  });
  return true;
}
