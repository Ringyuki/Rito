/**
 * SelectionEngine — a stateful, framework-agnostic text selection engine.
 *
 * State machine: idle → selecting → selected → idle
 *
 * Accepts pointer events in **spread-content** coordinates — the synthetic
 * space where `pageWidth = contentWidth` (no margins). The LayoutConfig passed
 * to `setSpread()` must describe this content-only space, not the full
 * viewport with margins. In `@ritojs/kit`, the CoordinateMapper provides
 * `selectionConfig` for this purpose, and `cssToSpreadContent()` converts
 * pointer events from display-css to spread-content.
 *
 * Returned rects from `getRects()` are also in spread-content space.
 */

import type { ReaderLocator, ReaderTextSelectionInteractions } from '@ritojs/core';
import type { LayoutConfig, Rect, Spread } from '../layout-types';
import type { TextMeasurer } from '../layout-types';
import { buildHitMap, resolveCharPosition } from '../core/hit-map';
import type { TextPosition, TextRange } from '../core/types';
import { compareTextPositions } from '../core/text-traversal';
import type { AnchoredPosition, SpreadContext } from './spread';
import { computeSelectionRects, isSamePosition, resolvePageHit } from './spread';
import { createNativeSelectionAdapter } from './native-adapter';
import { getLegacySelectionText } from './legacy-text';
import type {
  SelectionHandleCarets,
  SelectionHandleDrag,
  SelectionHandleEdge,
} from './handle-types';
import type { NativeSelectionGranularity } from './native-types';

export type {
  SelectionHandleCarets,
  SelectionHandleDrag,
  SelectionHandleEdge,
} from './handle-types';

export type SelectionState = 'idle' | 'selecting' | 'selected';
export type SelectionGranularity = NativeSelectionGranularity;

export interface PointerInput {
  readonly x: number;
  readonly y: number;
}

/** Anchored endpoint with page awareness. */
export interface PagedPosition {
  readonly pageIndex: number;
  readonly position: TextPosition;
}

/**
 * Snapshot of the current selection with both user-intent and document-order semantics.
 * - `anchor`/`focus`: pointer direction (where the user started / ended dragging)
 * - `start`/`end`: document order (always start <= end)
 */
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

export interface SelectionEngine {
  beginHandleDrag(edge: SelectionHandleEdge): SelectionHandleDrag | null;
  handlePointerDown(input: PointerInput, granularity?: SelectionGranularity): void;
  handlePointerMove(input: PointerInput): void;
  handlePointerUp(input: PointerInput): void;
  setSpread(
    spread: Spread,
    config: LayoutConfig,
    measurer: TextMeasurer,
    nativeProjection?: NativeSelectionProjection,
  ): void;
  /** Returns the selection range in document order (start <= end). */
  getSelection(): TextRange | null;
  /** Returns a snapshot with both pointer-semantic and document-order endpoints. */
  getSnapshot(): SelectionSnapshot | null;
  /** Whether either the legacy or exact native path owns a non-collapsed selection. */
  hasSelection(): boolean;
  getText(): string;
  /** Durable source identity, available for exact native selections. */
  getSourceLocator(): ReaderLocator | null;
  getRects(): readonly Rect[];
  /** Exact focus caret in spread-content coordinates when available. */
  getFocusRect(): Rect | null;
  /** Which document-order edge currently follows the pointer. */
  getFocusEdge(): 'start' | 'end' | null;
  /** Exact document-order endpoints for native touch handles, when available. */
  getHandleCarets(): SelectionHandleCarets | null;
  getState(): SelectionState;
  clear(): void;
  /** Cancel revision-bound work while retaining the engine for the next spread. */
  invalidate(): void;
  /** Permanently cancel work and detach listeners. */
  dispose(): void;
  onSelectionChange(cb: (range: TextRange | null) => void): () => void;
  onError(cb: (error: unknown) => void): () => void;
}

/** Create a new SelectionEngine instance. */
export function createSelectionEngine(
  nativeCapability?: ReaderTextSelectionInteractions,
): SelectionEngine {
  if (nativeCapability) return createNativeSelectionAdapter(nativeCapability);
  const s = createState();
  return buildEngine(s);
}

interface EngineState {
  state: SelectionState;
  ctx: SpreadContext | undefined;
  spread: Spread | undefined;
  anchor: AnchoredPosition | undefined;
  focus: AnchoredPosition | undefined;
  cachedRects: readonly Rect[] | undefined;
  listeners: Set<(range: TextRange | null) => void>;
}

function createState(): EngineState {
  return {
    state: 'idle',
    ctx: undefined,
    spread: undefined,
    anchor: undefined,
    focus: undefined,
    cachedRects: undefined,
    listeners: new Set(),
  };
}

/** Returns the selection range in document order (start <= end). Always normalized. */
function getRange(s: EngineState): TextRange | null {
  const snap = getSnapshotFromState(s);
  if (!snap) return null;
  return { start: snap.start.position, end: snap.end.position };
}

/** Build a snapshot with both pointer-semantic (anchor/focus) and document-order (start/end) endpoints. */
function getSnapshotFromState(s: EngineState): SelectionSnapshot | null {
  if (!s.anchor || !s.focus) return null;
  const anchor: PagedPosition = { pageIndex: s.anchor.pageIndex, position: s.anchor.position };
  const focus: PagedPosition = { pageIndex: s.focus.pageIndex, position: s.focus.position };

  const anchorFirst =
    s.anchor.pageIndex !== s.focus.pageIndex
      ? s.anchor.pageIndex < s.focus.pageIndex
      : compareTextPositions(s.anchor.position, s.focus.position) <= 0;

  return anchorFirst
    ? { anchor, focus, start: anchor, end: focus }
    : { anchor, focus, start: focus, end: anchor };
}

function notify(s: EngineState): void {
  const range = getRange(s);
  for (const cb of s.listeners) cb(range);
}

function resolve(input: PointerInput, s: EngineState): AnchoredPosition | undefined {
  if (!s.ctx) return undefined;
  const hit = resolvePageHit(input.x, input.y, s.ctx);
  if (!hit) return undefined;
  const position = resolveCharPosition(hit.hitMap, hit.localX, hit.localY, s.ctx.measurer);
  if (!position) return undefined;
  return { pageIndex: hit.pageIndex, position };
}

function handleDown(s: EngineState, input: PointerInput, clear: () => void): void {
  if (s.state === 'selected') clear();
  const pos = resolve(input, s);
  if (!pos) return;
  s.anchor = pos;
  s.focus = pos;
  s.state = 'selecting';
  s.cachedRects = undefined;
}

function handleMove(s: EngineState, input: PointerInput): void {
  if (s.state !== 'selecting') return;
  const pos = resolve(input, s);
  if (!pos) return;
  s.focus = pos;
  s.cachedRects = undefined;
  notify(s);
}

function handleUp(s: EngineState, input: PointerInput): void {
  if (s.state !== 'selecting') return;
  const finalPosition = resolve(input, s);
  if (finalPosition) s.focus = finalPosition;
  if (s.anchor && s.focus && isSamePosition(s.anchor, s.focus)) {
    clearState(s);
    notify(s);
    return;
  }
  s.state = 'selected';
  notify(s);
}

function clearState(s: EngineState): void {
  s.anchor = undefined;
  s.focus = undefined;
  s.state = 'idle';
  s.cachedRects = undefined;
}

function buildEngine(s: EngineState): SelectionEngine {
  return {
    beginHandleDrag: () => null,
    handlePointerDown(input) {
      handleDown(s, input, () => {
        clearEngine(s);
      });
    },
    handlePointerMove(input) {
      handleMove(s, input);
    },
    handlePointerUp(input) {
      handleUp(s, input);
    },
    setSpread(spread, config, measurer) {
      s.ctx = {
        config,
        measurer,
        leftHitMap: spread.left ? buildHitMap(spread.left) : undefined,
        rightHitMap: spread.right ? buildHitMap(spread.right) : undefined,
      };
      s.spread = spread;
      clearEngine(s);
    },
    getSelection: () => getRange(s),
    getSnapshot: () => getSnapshotFromState(s),
    hasSelection: () =>
      s.anchor !== undefined && s.focus !== undefined && !isSamePosition(s.anchor, s.focus),
    getText: () => getLegacySelectionText(s.spread, s.anchor, s.focus, getRange(s)),
    getSourceLocator: () => null,
    getRects: () => getRectsFromState(s),
    getFocusRect: () => null,
    getFocusEdge: () => getFocusEdgeFromState(s),
    getHandleCarets: () => null,
    getState: () => s.state,
    ...buildLifecycleMethods(s),
  };
}

function buildLifecycleMethods(
  s: EngineState,
): Pick<SelectionEngine, 'clear' | 'invalidate' | 'dispose' | 'onSelectionChange' | 'onError'> {
  return {
    clear() {
      clearEngine(s);
    },
    invalidate() {
      clearEngine(s);
    },
    dispose() {
      clearState(s);
      s.ctx = undefined;
      s.spread = undefined;
      s.listeners.clear();
    },
    onSelectionChange: (cb) => {
      s.listeners.add(cb);
      return () => s.listeners.delete(cb);
    },
    onError: () => () => undefined,
  };
}

function clearEngine(s: EngineState): void {
  const had = s.anchor !== undefined;
  clearState(s);
  if (had) notify(s);
}

function getFocusEdgeFromState(s: EngineState): 'start' | 'end' | null {
  const snapshot = getSnapshotFromState(s);
  if (!snapshot) return null;
  return snapshot.focus === snapshot.start ? 'start' : 'end';
}

function getRectsFromState(s: EngineState): readonly Rect[] {
  if (s.cachedRects) return s.cachedRects;
  const range = getRange(s);
  if (!range || !s.ctx || !s.anchor || !s.focus) return [];
  s.cachedRects = computeSelectionRects(range, s.ctx, s.anchor, s.focus);
  return s.cachedRects;
}
