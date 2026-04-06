/**
 * SelectionEngine — a stateful, framework-agnostic text selection engine.
 *
 * State machine: idle → selecting → selected → idle
 *
 * Accepts pointer events in **spread-content** coordinates — the synthetic
 * space where `pageWidth = contentWidth` (no margins). The LayoutConfig passed
 * to `setSpread()` must describe this content-only space, not the full
 * viewport with margins. In `@rito/kit`, the CoordinateMapper provides
 * `selectionConfig` for this purpose, and `cssToSpreadContent()` converts
 * pointer events from display-css to spread-content.
 *
 * Returned rects from `getRects()` are also in spread-content space.
 */

import type { LayoutConfig, Rect, Spread } from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import { buildHitMap, resolveCharPosition } from '../core/hit-map';
import { getFirstTextPosition, getLastTextPosition } from '../core/text-traversal';
import type { TextPosition, TextRange } from '../core/types';
import { compareTextPositions } from '../core/text-traversal';
import { getSelectedText } from './range';
import type { AnchoredPosition, SpreadContext } from './spread';
import { computeSelectionRects, isSamePosition, resolvePageHit } from './spread';

export type SelectionState = 'idle' | 'selecting' | 'selected';

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

export interface SelectionEngine {
  handlePointerDown(input: PointerInput): void;
  handlePointerMove(input: PointerInput): void;
  handlePointerUp(input: PointerInput): void;
  setSpread(spread: Spread, config: LayoutConfig, measurer: TextMeasurer): void;
  /** Returns the selection range in document order (start <= end). */
  getSelection(): TextRange | null;
  /** Returns a snapshot with both pointer-semantic and document-order endpoints. */
  getSnapshot(): SelectionSnapshot | null;
  getText(): string;
  getRects(): readonly Rect[];
  getState(): SelectionState;
  clear(): void;
  onSelectionChange(cb: (range: TextRange | null) => void): () => void;
}

/** Create a new SelectionEngine instance. */
export function createSelectionEngine(): SelectionEngine {
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

function handleUp(s: EngineState): void {
  if (s.state !== 'selecting') return;
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
  const engine: SelectionEngine = {
    handlePointerDown(input) {
      handleDown(s, input, () => {
        engine.clear();
      });
    },
    handlePointerMove(input) {
      handleMove(s, input);
    },
    handlePointerUp() {
      handleUp(s);
    },
    setSpread(spread, config, measurer) {
      s.ctx = {
        config,
        measurer,
        leftHitMap: spread.left ? buildHitMap(spread.left) : undefined,
        rightHitMap: spread.right ? buildHitMap(spread.right) : undefined,
      };
      s.spread = spread;
      engine.clear();
    },
    getSelection: () => getRange(s),
    getSnapshot: () => getSnapshotFromState(s),
    getText: () => getTextFromState(s),
    getRects: () => getRectsFromState(s),
    getState: () => s.state,
    clear() {
      const had = s.anchor !== undefined;
      clearState(s);
      if (had) notify(s);
    },
    onSelectionChange: (cb) => {
      s.listeners.add(cb);
      return () => s.listeners.delete(cb);
    },
  };
  return engine;
}

function getTextFromState(s: EngineState): string {
  const range = getRange(s);
  if (!range || !s.spread || !s.anchor || !s.focus) return '';

  // Same page — straightforward
  if (s.anchor.pageIndex === s.focus.pageIndex) {
    const page = s.anchor.pageIndex === s.spread.left?.index ? s.spread.left : s.spread.right;
    if (!page) return '';
    return getSelectedText(page, range);
  }

  // Cross-page: concatenate text from both pages
  const [startAnchor, endAnchor] =
    s.anchor.pageIndex < s.focus.pageIndex ? [s.anchor, s.focus] : [s.focus, s.anchor];
  const startPage = startAnchor.pageIndex === s.spread.left?.index ? s.spread.left : s.spread.right;
  const endPage = endAnchor.pageIndex === s.spread.left?.index ? s.spread.left : s.spread.right;
  let text = '';
  const startEnd = startPage ? getLastTextPosition(startPage) : undefined;
  if (startPage && startEnd)
    text += getSelectedText(startPage, {
      start: startAnchor.position,
      end: startEnd,
    });
  const endStart = endPage ? getFirstTextPosition(endPage) : undefined;
  if (endPage && endStart)
    text += getSelectedText(endPage, { start: endStart, end: endAnchor.position });
  return text;
}

function getRectsFromState(s: EngineState): readonly Rect[] {
  if (s.cachedRects) return s.cachedRects;
  const range = getRange(s);
  if (!range || !s.ctx || !s.anchor || !s.focus) return [];
  s.cachedRects = computeSelectionRects(range, s.ctx, s.anchor, s.focus);
  return s.cachedRects;
}
