import type { ReaderLocatorResolution } from '@ritojs/core';
import type {
  ActiveChapterLocalTransition,
  NavigationState,
  PendingLocatorNavigation,
} from './state';

export type ResolvedLocator = Extract<ReaderLocatorResolution, { readonly status: 'resolved' }>;

export function finishChapterLocalLease(active: ActiveChapterLocalTransition): void {
  if (active.leaseFinished) return;
  active.leaseFinished = true;
  try {
    active.lease.finish();
  } catch {
    // Pool/runtime ownership is terminal independently of the host release callback.
  }
}

export function ownedPendingLocator(state: NavigationState): PendingLocatorNavigation | undefined {
  const pending = state.pendingLocatorNavigation;
  return pending && ownsPendingLocator(state, pending) ? pending : undefined;
}

export function ownsPendingLocator(
  state: NavigationState,
  pending: PendingLocatorNavigation,
): boolean {
  return !state.disposed && pending.attemptId === state.navigationAttemptId;
}

export function oppositeDirection(direction: 'forward' | 'backward'): 'forward' | 'backward' {
  return direction === 'forward' ? 'backward' : 'forward';
}
