import type { ReaderTextSelectionMovement, ReaderWritingMode } from '@ritojs/core';
import type { SelectionEngine } from './engine';
import type { NativeSelectionKeyboardCommand } from './native-types';

export interface SelectionKeyboardOwner {
  canExtend(): boolean;
  /** The writing mode of the line the selection's focus is on. */
  focusWritingMode(): ReaderWritingMode;
  begin(movement: ReaderTextSelectionMovement): NativeSelectionKeyboardCommand | null;
}

const keyboardOwners = new WeakMap<SelectionEngine, SelectionKeyboardOwner>();

/** Register a private exact-selection keyboard path without widening SelectionEngine. */
export function registerSelectionKeyboardOwner(
  selection: SelectionEngine,
  owner: SelectionKeyboardOwner,
): void {
  keyboardOwners.set(selection, owner);
}

export function getSelectionKeyboardOwner(
  selection: SelectionEngine,
): SelectionKeyboardOwner | null {
  return keyboardOwners.get(selection) ?? null;
}
