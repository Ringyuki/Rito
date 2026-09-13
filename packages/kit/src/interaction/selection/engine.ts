/**
 * SelectionEngine — the synchronous read facade over the reader's exact text
 * selection capability.
 *
 * Pointer input arrives in **spread-content** coordinates (the space where
 * `pageWidth = contentWidth`, no margins). The controller supplies a
 * `NativeSelectionProjection` on every spread render; the engine projects
 * pointer samples through it into page-local points for the reader, and
 * projects the reader's page-local rectangles back into spread-content space
 * for `getRects()`, `getFocusRect()`, and `getHandleCarets()`.
 *
 * Every read against the reader is asynchronous and revision-bound: spread
 * changes, layout invalidation, `clear()`, `invalidate()`, and `dispose()`
 * discard late results.
 */

import type {
  ReaderDocumentSourceSpan,
  ReaderLocator,
  ReaderTextSelectionInteractions,
} from '@ritojs/core';
import type { Rect } from '../layout-types';
import { createNativeSelectionAdapter } from './native-adapter';
import type {
  SelectionHandleCarets,
  SelectionHandleDrag,
  SelectionHandleEdge,
} from './handle-types';
import type { NativeSelectionGranularity } from './native-types';
import type { NativeSelectionProjection, PointerInput } from './engine-types';

export type {
  SelectionHandleCarets,
  SelectionHandleDrag,
  SelectionHandleEdge,
} from './handle-types';
export type { NativeSelectionProjection, PointerInput } from './engine-types';

export type SelectionState = 'idle' | 'selecting' | 'selected';
export type SelectionGranularity = NativeSelectionGranularity;

export interface SelectionEngine {
  beginHandleDrag(edge: SelectionHandleEdge): SelectionHandleDrag | null;
  handlePointerDown(input: PointerInput, granularity?: SelectionGranularity): void;
  handlePointerMove(input: PointerInput): void;
  handlePointerUp(input: PointerInput): void;
  /** Install the projection for the visible spread; discards any selection not owned by a transferred gesture. */
  setSpread(projection: NativeSelectionProjection): void;
  /** Whether a non-collapsed selection is committed or in progress. */
  hasSelection(): boolean;
  getText(): string;
  /** Durable source identity of the selection, when both endpoints share a resource. */
  getSourceLocator(): ReaderLocator | null;
  /** Resource-qualified durable endpoints of the selection. */
  getSourceSpan(): ReaderDocumentSourceSpan | null;
  getRects(): readonly Rect[];
  /** Exact focus caret in spread-content coordinates when its page is visible. */
  getFocusRect(): Rect | null;
  /** Which document-order edge currently follows the pointer. */
  getFocusEdge(): 'start' | 'end' | null;
  /** Exact document-order endpoints for touch handles, when a selection exists. */
  getHandleCarets(): SelectionHandleCarets | null;
  getState(): SelectionState;
  clear(): void;
  /** Cancel revision-bound work while retaining the engine for the next spread. */
  invalidate(): void;
  /** Permanently cancel work and detach listeners. */
  dispose(): void;
  onSelectionChange(cb: () => void): () => void;
  onError(cb: (error: unknown) => void): () => void;
}

/** Create the SelectionEngine over the reader's exact text selection capability. */
export function createSelectionEngine(
  capability: ReaderTextSelectionInteractions,
): SelectionEngine {
  return createNativeSelectionAdapter(capability);
}
