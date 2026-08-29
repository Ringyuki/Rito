import {
  activeLocalPreview,
  beginLocalFinalizing,
  dismissLocalPreview,
  endLocalFinalizing,
  enqueueIntent,
  queuedLocatorSeek,
  queuedSpreadTurn,
} from '../machine';
import type { ActiveChapterLocalTransition, NavigationMachine } from '../machine';
import { publishSpreadChange } from '../../core/spread-change';
import type { NavigationDeps } from '../index';
import { continuePendingNavigation } from '../growth';
import { finishChapterLocalLease, type ResolvedLocator } from './shared';
import { resumeQueuedChapterLocalNavigation } from './start';

export function completeExactPromotion(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  exact: ResolvedLocator,
): void {
  if (activeLocalPreview(machine) !== active) return;
  finishChapterLocalLease(active);
  dismissLocalPreview(machine);
  if (queuedLocatorSeek(machine) === active.pending) {
    enqueueIntent(machine, undefined);
  }
  deps.setCurrentSpread(exact.spreadIndex, 'chapter-local-promotion');
  const reader = deps.getReader();
  beginLocalFinalizing(machine);
  try {
    reader?.notifyActiveSpread(exact.spreadIndex);
    if (
      !active.exactPublished &&
      reader &&
      publishSpreadChange(deps.emitter, reader, exact.spreadIndex)
    ) {
      active.exactPublished = true;
    }
  } finally {
    try {
      deps.provisionalRuntime?.complete(active.direction);
      emitTerminationOutcome(deps, active);
    } finally {
      endLocalFinalizing(machine);
      resumeAllQueuedNavigation(machine, deps);
    }
  }
}

export function finishTerminatedTransition(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): void {
  if (activeLocalPreview(machine) !== active) return;
  finishChapterLocalLease(active);
  dismissLocalPreview(machine);
  if (queuedLocatorSeek(machine) === active.pending) {
    enqueueIntent(machine, undefined);
    active.pending.locatorAbort.abort();
  }
  beginLocalFinalizing(machine);
  try {
    try {
      deps.getReader()?.notifyActiveSpread(active.mountSpreadIndex);
    } finally {
      deps.provisionalRuntime?.complete(active.direction);
    }
    emitTerminationOutcome(deps, active);
  } finally {
    endLocalFinalizing(machine);
    resumeAllQueuedNavigation(machine, deps);
  }
}

export function tryFinishRestoredMount(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): boolean {
  if (activeLocalPreview(machine) !== active) return false;
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
        tryCompleteExactFallback(machine, deps, active);
      }
    }
    return activeLocalPreview(machine) !== active;
  }
  finishTerminatedTransition(machine, deps, active);
  return true;
}

export function tryCompleteExactFallback(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): boolean {
  const exact = active.pending.exactResolution;
  if (
    !exact ||
    active.phase !== 'awaitingExactFallback' ||
    activeLocalPreview(machine) !== active
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
  completeExactPromotion(machine, deps, active, exact);
  return true;
}

export function fatalChapterLocalContainment(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  message: string,
): void {
  if (activeLocalPreview(machine) !== active) return;
  console.error(
    `[rito] chapter-local presentation failed, rolling back to spread ${String(active.mountSpreadIndex)}: ${message}`,
  );
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
  if (activeLocalPreview(machine) !== active) return;
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
    tryFinishRestoredMount(machine, deps, active);
  } catch {
    if (activeLocalPreview(machine) === active) {
      forceTerminateBrokenPresentation(machine, deps, active, message);
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
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  action: () => void,
): void {
  try {
    action();
  } catch (error) {
    if (activeLocalPreview(machine) !== active) return;
    fatalChapterLocalContainment(
      machine,
      deps,
      active,
      error instanceof Error ? error.message : 'chapter-local transition failed',
    );
  }
}

function forceTerminateBrokenPresentation(
  machine: NavigationMachine,
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
  if (activeLocalPreview(machine) === active) {
    dismissLocalPreview(machine);
  }
  if (queuedLocatorSeek(machine) === active.pending) {
    enqueueIntent(machine, undefined);
    active.pending.locatorAbort.abort();
  }
  beginLocalFinalizing(machine);
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
    endLocalFinalizing(machine);
    try {
      resumeAllQueuedNavigation(machine, deps);
    } catch {
      // A queued consumer failure cannot resurrect the broken owner.
    }
  }
}

function resumeQueuedSpreadNavigation(machine: NavigationMachine, deps: NavigationDeps): void {
  if (machine.foreground.kind === 'local-finalizing') return;
  const pending = queuedSpreadTurn(machine);
  if (!pending || pending.attemptId !== machine.claimSeq) return;
  continuePendingNavigation(machine, deps, pending.target);
}

export function resumeAllQueuedNavigation(machine: NavigationMachine, deps: NavigationDeps): void {
  resumeQueuedChapterLocalNavigation(machine, deps);
  resumeQueuedSpreadNavigation(machine, deps);
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
