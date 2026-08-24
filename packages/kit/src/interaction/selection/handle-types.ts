import type { Rect } from '../layout-types';

interface SelectionHandlePoint {
  readonly x: number;
  readonly y: number;
}

export type SelectionHandleEdge = 'start' | 'end';

/** Exact native range endpoints projected into spread-content coordinates. */
export interface SelectionHandleCarets {
  readonly start: Rect | null;
  readonly end: Rect | null;
  readonly focusEdge: SelectionHandleEdge | null;
}

/** One epoch-bound native endpoint adjustment in spread-content coordinates. */
export interface SelectionHandleDrag {
  update(input: SelectionHandlePoint): void;
  finish(input: SelectionHandlePoint): void;
  cancel(): void;
}
