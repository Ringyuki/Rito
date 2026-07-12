import type { Internals, SelectionAccessorsSlice } from './types';

export function buildSelectionAccessors(internals: Internals): SelectionAccessorsSlice {
  return {
    clearSelection(): void {
      internals.engines.selection.clear();
    },
    get hasSelection() {
      return internals.engines.selection.hasSelection();
    },
    get selectionText() {
      return internals.engines.selection.getText();
    },
    get selectionRange() {
      return internals.engines.selection.getSelection();
    },
    get selectionSourceLocator() {
      return internals.engines.selection.getSourceLocator();
    },
  };
}
