import type { NavigationDeps } from './index';
import { continuePendingNavigation } from './growth';
import { finishChapterLocalLease, type ResolvedLocator } from './chapter-local-preview-shared';
import { resumeQueuedChapterLocalNavigation } from './chapter-local-preview-start';
import type { ActiveChapterLocalTransition, NavigationState } from './state';

export function completeExactPromotion(
  state: NavigationState,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  exact: ResolvedLocator,
): void {
  if (state.activeChapterLocalTransition !== active) return;
  finishChapterLocalLease(active);
  state.activeChapterLocalTransition = undefined;
  if (state.pendingLocatorNavigation === active.pending) {
    state.pendingLocatorNavigation = undefined;
  }
  deps.setCurrentSpread(exact.spreadIndex);
  const reader = deps.getReader();
  state.finalizingChapterLocalTransition = true;
  try {
    reader?.notifyActiveSpread(exact.spreadIndex);
    const spread = reader?.spreads[exact.spreadIndex];
    if (!active.exactPublished && spread) {
      active.exactPublished = true;
      deps.emitter.emit('spreadChange', { spreadIndex: exact.spreadIndex, spread });
    }
  } finally {
    try {
      deps.provisionalRuntime?.complete(active.direction);
      emitTerminationOutcome(deps, active);
    } finally {
      state.finalizingChapterLocalTransition = false;
      resumeAllQueuedNavigation(state, deps);
    }
  }
}

export function finishTerminatedTransition(
  state: NavigationState,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): void {
  if (state.activeChapterLocalTransition !== active) return;
  finishChapterLocalLease(active);
  state.activeChapterLocalTransition = undefined;
  if (state.pendingLocatorNavigation === active.pending) {
    state.pendingLocatorNavigation = undefined;
    active.pending.locatorAbort.abort();
  }
  state.finalizingChapterLocalTransition = true;
  try {
    try {
      deps.getReader()?.notifyActiveSpread(active.mountSpreadIndex);
    } finally {
      deps.provisionalRuntime?.complete(active.direction);
    }
    emitTerminationOutcome(deps, active);
  } finally {
    state.finalizingChapterLocalTransition = false;
    resumeAllQueuedNavigation(state, deps);
  }
}

export function tryFinishRestoredMount(
  state: NavigationState,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): boolean {
  if (state.activeChapterLocalTransition !== active) return false;
  active.phase = 'restoringExact';
  if (active.mountExactPaintRequired) {
    if (!active.mountExactInvalidated) {
      deps.pool.invalidateContentForSpread(active.mountSpreadIndex);
      active.mountExactInvalidated = true;
    }
    if (!deps.pool.ensureContent('curr', deps.contentRenderer)) {
      deps.frameDriver.scheduleComposite();
      return false;
    }
  }
  deps.pool.invalidateOverlayForSpread(active.mountSpreadIndex);
  if (active.termination?.fallbackToExact) {
    finishChapterLocalLease(active);
    active.phase = 'awaitingExactFallback';
    active.pending.provisionalPhase = 'committed';
    active.pending.previewReadySpread = undefined;
    try {
      deps.getReader()?.notifyActiveSpread(active.mountSpreadIndex);
    } finally {
      if (active.pending.exactResolution) {
        tryCompleteExactFallback(state, deps, active);
      }
    }
    return state.activeChapterLocalTransition !== active;
  }
  finishTerminatedTransition(state, deps, active);
  return true;
}

export function tryCompleteExactFallback(
  state: NavigationState,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): boolean {
  const exact = active.pending.exactResolution;
  if (
    !exact ||
    active.phase !== 'awaitingExactFallback' ||
    state.activeChapterLocalTransition !== active
  ) {
    return false;
  }
  const current = deps.getCurrentSpread();
  if (exact.spreadIndex === current) {
    if (deps.pool.getSlotFor(exact.spreadIndex) !== 'curr') {
      deps.pool.assignSlot('curr', exact.spreadIndex);
    }
    deps.pool.invalidateContentForSpread(exact.spreadIndex);
    if (!deps.pool.ensureContent('curr', deps.contentRenderer)) return false;
  } else {
    const direction = exact.spreadIndex > current ? 'forward' : 'backward';
    const slot = direction === 'forward' ? 'next' : 'prev';
    if (deps.pool.getSlotFor(exact.spreadIndex) !== slot) {
      deps.pool.assignSlot(slot, exact.spreadIndex);
    }
    if (!deps.pool.ensureContent(slot, deps.contentRenderer)) return false;
    if (direction === 'forward') deps.pool.rotateForward();
    else deps.pool.rotateBackward();
  }
  completeExactPromotion(state, deps, active, exact);
  return true;
}

export function fatalChapterLocalContainment(
  state: NavigationState,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  message: string,
): void {
  if (state.activeChapterLocalTransition !== active) return;
  try {
    deps.td.reset();
  } catch {
    // Continue into the pool/runtime terminalizer.
  }
  const fallbackToExact =
    active.termination === undefined || active.termination.fallbackToExact === true;
  let restored = false;
  try {
    restored = deps.pool.containProvisionalFailure(active.stageToken, active.mountSpreadIndex);
  } catch {
    try {
      deps.pool.resetProvisionalState(active.mountSpreadIndex);
    } catch {
      // The last-resort terminalizer below still releases logical ownership.
    }
  }
  if (state.activeChapterLocalTransition !== active) return;
  active.termination = {
    kind: 'failed',
    error: new Error(message),
    failureSource: 'reader chapter-local presentation',
    fallbackToExact,
  };
  if (!restored) {
    active.mountExactPaintRequired = true;
    active.mountExactInvalidated = true;
  }
  try {
    tryFinishRestoredMount(state, deps, active);
  } catch {
    if (state.activeChapterLocalTransition === active) {
      forceTerminateBrokenPresentation(state, deps, active, message);
    }
  }
}

export function releaseProvisionalForTerminalMutation(
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): void {
  try {
    const released =
      active.phase === 'animating'
        ? deps.pool.cancelProvisionalStage(active.stageToken)
        : deps.pool.finishProvisionalStage(active.stageToken);
    if (!released) {
      deps.pool.containProvisionalFailure(active.stageToken, active.mountSpreadIndex);
    }
  } catch {
    try {
      deps.pool.resetProvisionalState(active.mountSpreadIndex);
    } catch {
      // Layout/disposal still release logical ownership.
    }
  }
}

export function safelyDriveActiveChapterLocal(
  state: NavigationState,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  action: () => void,
): void {
  try {
    action();
  } catch (error) {
    if (state.activeChapterLocalTransition !== active) return;
    fatalChapterLocalContainment(
      state,
      deps,
      active,
      error instanceof Error ? error.message : 'chapter-local transition failed',
    );
  }
}

function forceTerminateBrokenPresentation(
  state: NavigationState,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  message: string,
): void {
  try {
    deps.td.reset();
  } catch {
    // Best effort only.
  }
  try {
    deps.pool.resetProvisionalState(active.mountSpreadIndex);
  } catch {
    // Logical ownership must still be released.
  }
  finishChapterLocalLease(active);
  if (state.activeChapterLocalTransition === active) {
    state.activeChapterLocalTransition = undefined;
  }
  if (state.pendingLocatorNavigation === active.pending) {
    state.pendingLocatorNavigation = undefined;
    active.pending.locatorAbort.abort();
  }
  state.finalizingChapterLocalTransition = true;
  try {
    try {
      deps.provisionalRuntime?.complete(active.direction);
    } catch {
      // complete() clears its runtime owner before invoking external listeners.
    }
    try {
      deps.emitter.emit('error', {
        message,
        source: 'reader chapter-local presentation',
      });
    } catch {
      // Reporting cannot retain ownership.
    }
  } finally {
    state.finalizingChapterLocalTransition = false;
    try {
      resumeAllQueuedNavigation(state, deps);
    } catch {
      // A queued consumer failure cannot resurrect the broken owner.
    }
  }
}

function resumeQueuedSpreadNavigation(state: NavigationState, deps: NavigationDeps): void {
  if (state.finalizingChapterLocalTransition) return;
  const pending = state.pendingNavigation;
  if (!pending || pending.attemptId !== state.navigationAttemptId) return;
  continuePendingNavigation(state, deps, pending.target);
}

export function resumeAllQueuedNavigation(state: NavigationState, deps: NavigationDeps): void {
  resumeQueuedChapterLocalNavigation(state, deps);
  resumeQueuedSpreadNavigation(state, deps);
}

function emitTerminationOutcome(deps: NavigationDeps, active: ActiveChapterLocalTransition): void {
  const termination = active.termination;
  if (termination?.kind === 'failed') {
    deps.emitter.emit('error', {
      message:
        termination.error instanceof Error ? termination.error.message : String(termination.error),
      source: termination.failureSource ?? 'reader chapter-local presentation',
    });
  } else if (termination?.kind === 'cancelled') {
    deps.onNavigationCancelled?.();
  }
}
