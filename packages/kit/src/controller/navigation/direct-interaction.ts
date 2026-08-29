import {
  foregroundIsBusy,
  supersedeNavigationForDirectInteraction,
  type NavigationMachine,
} from './machine';
import type { NavigationDeps } from './index';
import { supersedeLocalPreview } from './local-preview';

type DirectInteractionDeps = Pick<
  NavigationDeps,
  | 'td'
  | 'pool'
  | 'frameDriver'
  | 'provisionalRuntime'
  | 'getCurrentSpread'
  | 'getReader'
  | 'contentRenderer'
  | 'setCurrentSpread'
  | 'emitter'
  | 'onNavigationCancelled'
  | 'onContentInteractionIntent'
>;

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
  supersedeLocalPreview(machine, deps as NavigationDeps);
  const result = supersedeNavigationForDirectInteraction(machine, deps.td);
  if (foregroundIsBusy(machine)) return null;
  return result.attemptId;
}
