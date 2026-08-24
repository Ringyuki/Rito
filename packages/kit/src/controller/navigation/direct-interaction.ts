import { supersedeNavigationForDirectInteraction, type NavigationState } from './state';
import type { NavigationDeps } from './index';
import { supersedeChapterLocalTransition } from './chapter-local-preview';

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
  supersedeChapterLocalTransition(state, deps as NavigationDeps);
  const result = supersedeNavigationForDirectInteraction(state, deps.td);
  if (state.activeChapterLocalTransition || state.finalizingChapterLocalTransition) return null;
  return result.attemptId;
}
