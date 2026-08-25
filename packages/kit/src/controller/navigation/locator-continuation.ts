import type { NavigationDeps } from './index';
import {
  enqueueIntent,
  queuedLocatorSeek,
  type NavigationMachine,
  type PendingLocatorNavigation,
} from './machine';

export function continueResolvedLocatorNavigation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  spreadIndex: number,
): void {
  if (
    machine.disposed ||
    queuedLocatorSeek(machine) !== pending ||
    machine.claimSeq !== pending.attemptId
  ) {
    return;
  }
  enqueueIntent(machine, undefined);
  try {
    pending.onResolved(spreadIndex);
  } catch (error) {
    containResolvedContinuationFailure(deps, pending.failureSource, error);
  }
}

function containResolvedContinuationFailure(
  deps: NavigationDeps,
  source: string,
  error: unknown,
): void {
  try {
    deps.onNavigationCancelled?.();
  } catch {
    // Position ownership is terminal even if its observer fails.
  }
  try {
    deps.emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source,
    });
  } catch {
    // Error listeners cannot resurrect resolved locator ownership.
  }
}
