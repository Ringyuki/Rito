import type { LayoutBlock } from '../core/types';
import type { FloatContext } from './float-context';

export interface LayoutState {
  blocks: LayoutBlock[];
  floats: FloatContext;
  y: number;
  prevMarginBottom: number;
}

/** CSS margin collapse: two positive → max, two negative → min, mixed → sum. */
export function collapseMargin(state: LayoutState, marginTop: number): void {
  const a = state.prevMarginBottom;
  const b = marginTop;
  if (a >= 0 && b >= 0) {
    state.y += Math.max(a, b);
  } else if (a < 0 && b < 0) {
    state.y += Math.min(a, b);
  } else {
    state.y += a + b;
  }
}
