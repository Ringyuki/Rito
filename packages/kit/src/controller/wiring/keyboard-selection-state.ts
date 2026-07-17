import type { ReaderTextSelectionMovement } from '@ritojs/core';
import type { SelectionKeyboardOwner } from '../../interaction/selection/selection-keyboard-owner';
import type { NativeSelectionKeyboardCommand } from '../../interaction/selection/native-types';
import type { KeyboardSelectionIntentState } from './keyboard-selection-intent';

export interface KeyboardSelectionState extends KeyboardSelectionIntentState {
  readonly owner: SelectionKeyboardOwner;
  readonly movements: ReaderTextSelectionMovement[];
  generation: number;
  pumping: boolean;
  disposed: boolean;
  currentCommand: NativeSelectionKeyboardCommand | undefined;
  waitAbort: AbortController | undefined;
}

export function createKeyboardSelectionState(
  owner: SelectionKeyboardOwner,
): KeyboardSelectionState {
  return {
    owner,
    movements: [],
    intentGeneration: undefined,
    generation: 0,
    pumping: false,
    disposed: false,
    currentCommand: undefined,
    waitAbort: undefined,
  };
}

export function cancelKeyboardSelectionQueue(state: KeyboardSelectionState): void {
  state.generation += 1;
  state.intentGeneration = undefined;
  state.movements.length = 0;
  state.waitAbort?.abort();
  state.waitAbort = undefined;
  state.currentCommand?.finish();
  state.currentCommand = undefined;
}

export function cancelOwnedKeyboardSelectionQueue(
  state: KeyboardSelectionState,
  generation: number,
): void {
  if (ownsKeyboardSelectionQueue(state, generation)) cancelKeyboardSelectionQueue(state);
}

export function ownsKeyboardSelectionQueue(
  state: KeyboardSelectionState,
  generation: number,
): boolean {
  return !state.disposed && state.generation === generation;
}
