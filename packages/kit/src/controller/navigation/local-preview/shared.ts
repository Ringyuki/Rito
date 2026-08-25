import { queuedLocatorSeek } from '../machine';
import type {
  ActiveChapterLocalTransition,
  NavigationMachine,
  PendingLocatorNavigation,
} from '../machine';
import type { ReaderLocatorResolution } from '@ritojs/core';

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

export function ownedPendingLocator(
  machine: NavigationMachine,
): PendingLocatorNavigation | undefined {
  const pending = queuedLocatorSeek(machine);
  return pending && ownsPendingLocator(machine, pending) ? pending : undefined;
}

export function ownsPendingLocator(
  machine: NavigationMachine,
  pending: PendingLocatorNavigation,
): boolean {
  return !machine.disposed && pending.attemptId === machine.claimSeq;
}

export function oppositeDirection(direction: 'forward' | 'backward'): 'forward' | 'backward' {
  return direction === 'forward' ? 'backward' : 'forward';
}
