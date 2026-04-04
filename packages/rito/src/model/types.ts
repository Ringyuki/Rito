/**
 * Shared types — re-exported from layout/core/types.ts for backward compatibility.
 */
import type { Rect } from '../layout/core/types';
export type { Rect } from '../layout/core/types';

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
