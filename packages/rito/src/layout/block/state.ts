import type { LayoutBlock } from '../core/types';
import type { FloatContext } from './float-context';

export interface LayoutState {
  blocks: LayoutBlock[];
  floats: FloatContext;
  y: number;
  prevMarginBottom: number;
}

/** CSS margin collapse: two positive → max, two negative → min, mixed → sum. */
function computeCollapsedMargin(a: number, b: number): number {
  if (a >= 0 && b >= 0) return Math.max(a, b);
  if (a < 0 && b < 0) return Math.min(a, b);
  return a + b;
}

export function collapseMargin(state: LayoutState, marginTop: number): void {
  state.y += computeCollapsedMargin(state.prevMarginBottom, marginTop);
}
