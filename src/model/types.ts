/**
 * Shared internal data structures and types used across modules.
 */

/** Represents a rectangular region in layout space. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

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
