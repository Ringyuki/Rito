import type { Rect } from '../layout-types';
import type { TextPosition } from '../core/types';

export interface PointerInput {
  readonly x: number;
  readonly y: number;
}

/** Anchored endpoint with page awareness. */
export interface PagedPosition {
  readonly pageIndex: number;
  readonly position: TextPosition;
}

/** Pointer-semantic and normalized document-order selection endpoints. */
export interface SelectionSnapshot {
  readonly anchor: PagedPosition;
  readonly focus: PagedPosition;
  readonly start: PagedPosition;
  readonly end: PagedPosition;
}

/** Controller-owned projection between spread-content and page-content spaces. */
export interface NativeSelectionProjection {
  spreadContentToPage(x: number, y: number): { pageIndex: number; x: number; y: number } | null;
  /** Whether page-local geometry belongs to the currently projected spread. */
  isPageVisible(pageIndex: number): boolean;
  pageContentToSpread(pageIndex: number, rect: Rect): Rect;
}
