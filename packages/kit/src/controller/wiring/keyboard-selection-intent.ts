import {
  ownsSelectionGesture,
  type SelectionGestureLease,
} from '../../interaction/selection/selection-interaction-owner';
import type { Internals, Nav } from '../facade/types';

export interface KeyboardSelectionIntentState {
  intentGeneration: number | undefined;
}

export function ownsKeyboardSelectionIntent(
  state: KeyboardSelectionIntentState,
  internals: Internals,
): boolean {
  return state.intentGeneration === internals.coordState.contentInteractionGeneration;
}

export function jumpWithKeyboardSelectionIntent(
  state: KeyboardSelectionIntentState,
  internals: Internals,
  nav: Nav,
  target: number,
  gesture: SelectionGestureLease,
): ReturnType<Nav['jumpToSpreadIfReady']> {
  const previous = state.intentGeneration;
  if (previous === undefined || !ownsKeyboardSelectionIntent(state, internals)) {
    return 'superseded';
  }
  const outcome = nav.jumpToSpreadIfReady(target, gesture);
  if (outcome === 'superseded' || !ownsSelectionGesture(gesture)) return 'superseded';
  const current = internals.coordState.contentInteractionGeneration;
  if (current !== previous + 1) return 'superseded';
  state.intentGeneration = current;
  return outcome;
}
