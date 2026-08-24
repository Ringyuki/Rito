import type { NativeSelectionSnapshot } from './native-types';

/** Map native pointer direction to the document-order edge controlled by the focus. */
export function getNativeSelectionFocusEdge(snapshot: NativeSelectionSnapshot): 'start' | 'end' {
  return snapshot.focusDirection === 'forward' ? 'end' : 'start';
}
