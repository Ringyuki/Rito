import { supersedeNavigationForDirectInteraction, type NavigationMachine } from './machine';
import type { NavigationDeps } from './index';

type DirectInteractionDeps = Pick<NavigationDeps, 'td' | 'onContentInteractionIntent'>;

export interface NavigationSelectionInputBarrier {
  owns(): boolean;
}

export function supersedeNavigationForSelectionIntent(
  machine: NavigationMachine,
  deps: DirectInteractionDeps,
): NavigationSelectionInputBarrier | null {
  const attemptId = supersedeDirectInteraction(machine, deps);
  if (attemptId === null || attemptId !== machine.claimSeq) return null;
  return { owns: () => !machine.disposed && machine.claimSeq === attemptId };
}

export function supersedeNavigationForPositionIntent(
  machine: NavigationMachine,
  deps: DirectInteractionDeps,
): void {
  supersedeDirectInteraction(machine, deps);
}

function supersedeDirectInteraction(
  machine: NavigationMachine,
  deps: DirectInteractionDeps,
): number | null {
  if (machine.disposed) return null;
  deps.onContentInteractionIntent?.();
  return supersedeNavigationForDirectInteraction(machine, deps.td).attemptId;
}
