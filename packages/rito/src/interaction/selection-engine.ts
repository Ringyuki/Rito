/**
 * L1 SelectionEngine — a stateful, framework-agnostic text selection engine.
 *
 * State machine: idle → selecting → selected → idle
 * Accepts pointer events in spread-local logical coordinates.
 * Consumer is responsible for coordinate transforms (DPR, canvas offset).
 */

import type { LayoutConfig, Rect, Spread } from '../layout/core/types';
import type { TextMeasurer } from '../layout/text/text-measurer';
import { buildHitMap, resolveCharPosition } from './hit-map';
import { getSelectedText } from './selection';
import type { AnchoredPosition, SpreadContext } from './spread-hit';
import { computeSelectionRects, isSamePosition, resolvePageHit } from './spread-hit';
import type { TextRange } from './types';

export type SelectionState = 'idle' | 'selecting' | 'selected';

export interface PointerInput {
  readonly x: number;
  readonly y: number;
}

export interface SelectionEngine {
  handlePointerDown(input: PointerInput): void;
  handlePointerMove(input: PointerInput): void;
  handlePointerUp(input: PointerInput): void;
  setSpread(spread: Spread, config: LayoutConfig, measurer: TextMeasurer): void;
  getSelection(): TextRange | null;
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

function getRange(s: EngineState): TextRange | null {
  if (!s.anchor || !s.focus) return null;
  if (s.anchor.pageIndex !== s.focus.pageIndex) {
    const [a, b] =
      s.anchor.pageIndex <= s.focus.pageIndex ? [s.anchor, s.focus] : [s.focus, s.anchor];
    return { start: a.position, end: b.position };
  }
  return { start: s.anchor.position, end: s.focus.position };
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
  if (!range || !s.spread) return '';
  const page = s.spread.left ?? s.spread.right;
  if (!page) return '';
  return getSelectedText(page, range);
}

function getRectsFromState(s: EngineState): readonly Rect[] {
  if (s.cachedRects) return s.cachedRects;
  const range = getRange(s);
  if (!range || !s.ctx || !s.anchor || !s.focus) return [];
  s.cachedRects = computeSelectionRects(range, s.ctx, s.anchor, s.focus);
  return s.cachedRects;
}
