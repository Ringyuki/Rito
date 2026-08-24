import type { NavigationDeps } from './index';
import type { NavigationState, PendingLocatorNavigation } from './state';

export function continueResolvedLocatorNavigation(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  spreadIndex: number,
): void {
  if (
    state.disposed ||
    state.pendingLocatorNavigation !== pending ||
    state.navigationAttemptId !== pending.attemptId
  ) {
    return;
  }
  state.pendingLocatorNavigation = undefined;
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
