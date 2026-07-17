import type { TransitionDriver } from '../../driver/transition-driver';
import { supersedeNavigationForDirectInteraction, type NavigationState } from './state';

interface DirectInteractionDeps {
  readonly td: TransitionDriver;
  readonly onContentInteractionIntent?: (() => void) | undefined;
}

export interface NavigationSelectionInputBarrier {
  owns(): boolean;
}

export function supersedeNavigationForSelectionIntent(
  state: NavigationState,
  deps: DirectInteractionDeps,
): NavigationSelectionInputBarrier | null {
  const attemptId = supersedeDirectInteraction(state, deps);
  if (attemptId === null || attemptId !== state.navigationAttemptId) return null;
  return { owns: () => !state.disposed && state.navigationAttemptId === attemptId };
}

export function supersedeNavigationForPositionIntent(
  state: NavigationState,
  deps: DirectInteractionDeps,
): void {
  supersedeDirectInteraction(state, deps);
}

function supersedeDirectInteraction(
  state: NavigationState,
  deps: DirectInteractionDeps,
): number | null {
  if (state.disposed) return null;
  deps.onContentInteractionIntent?.();
  const result = supersedeNavigationForDirectInteraction(state, deps.td);
  return result.attemptId;
}
