import type { Internals, SelectionAccessorsSlice } from './types';

export function buildSelectionAccessors(internals: Internals): SelectionAccessorsSlice {
  return {
    clearSelection(): void {
      internals.engines.selection.clear();
    },
    get selectionText() {
      return internals.engines.selection.getText();
    },
    get selectionRange() {
      return internals.engines.selection.getSelection();
    },
  };
}
