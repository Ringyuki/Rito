import type { NavigationDeps } from './index';
import type { NavigationMachine } from './machine';
import { clearQueuedIntent } from './machine';

/**
 * Ownership of one navigation intent. Every asynchronous continuation
 * checks `owns()` before touching shared state: a newer claim, a
 * dispose, or a direct interaction revokes all older claims by bumping
 * the machine's claim sequence. This replaces the hand-rolled
 * `attemptId !== state.navigationAttemptId` comparisons that used to be
 * repeated at every resumption point.
 */
export interface NavigationClaim {
  readonly id: number;
  owns(): boolean;
}

export function claimOf(machine: NavigationMachine, id: number): NavigationClaim {
  return {
    id,
    owns: () => !machine.disposed && machine.claimSeq === id,
  };
}

/**
 * Claims navigation ownership for a new intent: revokes older claims,
 * clears the queued slot, and notifies the interaction/position layers.
 */
export function claimNavigation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  preservePositionIntent = false,
): NavigationClaim {
  const id = ++machine.claimSeq;
  clearQueuedIntent(machine);
  deps.onContentInteractionIntent?.();
  if (!preservePositionIntent) deps.onNavigationIntent?.();
  return claimOf(machine, id);
}
