/**
 * Shared types — re-exported from layout/types.ts for backward compatibility.
 */
import type { Rect } from '../layout/types';
export type { Rect } from '../layout/types';

/** Represents spacing values (margin, padding). */
export interface Spacing {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Base interface for elements in the layout tree. */
export interface LayoutElement {
  readonly bounds: Rect;
  readonly type: string;
}
