import type { ComputedStyle } from '../../../style/core/types';
import type { InlineAtom, LineBox, RubyAnnotation, TextRun } from '../../core/types';
import type { StyledSegment } from '../../text/styled-segment';
import { withTrailingEndEdge } from '../../text/run-paint-from-style';
import { applyAlign, computeEffectiveLineMetrics, shiftRunsY } from '../../text/text-align';
import type { TextMeasurer } from '../../text/text-measurer';
import type { KPItem } from './types';
import { buildLineRuns, type Run, type RunLocation } from './run-builder';

interface LineBuildState {
  readonly lines: LineBox[];
  lineStart: number;
  y: number;
  readonly startedSegments: Set<StyledSegment>;
  readonly trailingEdgeTracker: Map<StyledSegment, RunLocation>;
}

export function buildLineBoxes(
  items: readonly KPItem[],
  breakPositions: readonly number[],
  maxWidth: number,
  indent: number,
  startY: number,
  lineHeight: number,
  baseStyle: ComputedStyle,
  measurer: TextMeasurer,
): LineBox[] {
  const state = createLineBuildState(startY);
  for (let lineIndex = 0; lineIndex < breakPositions.length; lineIndex++) {
    const breakPos = breakPositions[lineIndex];
    if (breakPos === undefined) continue;
    appendLineBox(state, items, breakPos, lineIndex, breakPositions.length, {
      maxWidth,
      indent,
      lineHeight,
      baseStyle,
      measurer,
    });
  }
  applyTrailingEdges(state.lines, state.trailingEdgeTracker);
  return state.lines;
}

function createLineBuildState(startY: number): LineBuildState {
  return {
    lines: [],
    lineStart: 0,
    y: startY,
    startedSegments: new Set<StyledSegment>(),
    trailingEdgeTracker: new Map<StyledSegment, RunLocation>(),
  };
}

function appendLineBox(
  state: LineBuildState,
  items: readonly KPItem[],
  breakPos: number,
  lineIndex: number,
  lineCount: number,
  options: {
    readonly maxWidth: number;
    readonly indent: number;
    readonly lineHeight: number;
    readonly baseStyle: ComputedStyle;
    readonly measurer: TextMeasurer;
  },
): void {
  const startX = lineIndex === 0 && options.indent !== 0 ? options.indent : 0;
  const runs = buildLineRuns(
    items,
    state.lineStart,
    breakPos,
    startX,
    options.lineHeight,
    options.measurer,
    options.baseStyle.fontSize,
    state.startedSegments,
    state.trailingEdgeTracker,
    state.lines.length,
  );
  appendRunsAsLine(
    state,
    runs,
    options,
    isLastLineForTextAlign(items, breakPos, lineIndex, lineCount),
    shouldKeepEmptyLine(items, breakPos, lineIndex, lineCount),
  );
  state.lineStart = breakPos + 1;
}

function appendRunsAsLine(
  state: LineBuildState,
  runs: Run[],
  options: {
    readonly maxWidth: number;
    readonly lineHeight: number;
    readonly baseStyle: ComputedStyle;
  },
  isLastLineForTextAlign: boolean,
  keepEmptyLine: boolean,
): void {
  if (runs.length === 0) {
    appendEmptyLineIfNeeded(state, options, keepEmptyLine);
    return;
  }
  const lineWidth = runs.reduce(
    (currentMax, run) => Math.max(currentMax, run.bounds.x + run.bounds.width),
    0,
  );
  const { height: effectiveLH, yShift } = computeEffectiveLineMetrics(runs, options.lineHeight);
  shiftRunsY(runs, yShift);
  state.lines.push(
    applyAlign(
      runs,
      lineWidth,
      state.y,
      effectiveLH,
      options.maxWidth,
      options.baseStyle.textAlign,
      options.baseStyle.textJustify,
      isLastLineForTextAlign,
    ),
  );
  state.y += effectiveLH;
}

function appendEmptyLineIfNeeded(
  state: LineBuildState,
  options: {
    readonly maxWidth: number;
    readonly lineHeight: number;
  },
  keepEmptyLine: boolean,
): void {
  if (!keepEmptyLine) return;
  state.lines.push({
    type: 'line-box',
    bounds: { x: 0, y: state.y, width: options.maxWidth, height: options.lineHeight },
    runs: [],
  });
  state.y += options.lineHeight;
}

function isForcedBreak(items: readonly KPItem[], breakPos: number): boolean {
  const item = items[breakPos];
  return item?.type === 'penalty' && item.penalty === -Infinity;
}

function isLastLineForTextAlign(
  items: readonly KPItem[],
  breakPos: number,
  lineIndex: number,
  lineCount: number,
): boolean {
  return (
    lineIndex === lineCount - 1 ||
    isForcedBreak(items, breakPos) ||
    hasOnlyBreakMarkersBeforeForcedBreak(items, breakPos)
  );
}

function hasOnlyBreakMarkersBeforeForcedBreak(items: readonly KPItem[], breakPos: number): boolean {
  for (let index = breakPos + 1; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;
    if (item.type === 'penalty' && item.penalty === -Infinity) return true;
    if (item.type === 'box') return false;
  }
  return false;
}

function shouldKeepEmptyLine(
  items: readonly KPItem[],
  breakPos: number,
  lineIndex: number,
  lineCount: number,
): boolean {
  return lineIndex < lineCount - 1 && isForcedBreak(items, breakPos);
}

function applyTrailingEdges(
  lines: readonly LineBox[],
  trailingEdgeTracker: ReadonlyMap<StyledSegment, RunLocation>,
): void {
  for (const [segment, loc] of trailingEdgeTracker) {
    const line = lines[loc.lineIdx];
    if (!line) continue;
    const runs = line.runs as (TextRun | InlineAtom | RubyAnnotation)[];
    patchTrailingRun(runs, loc.runIdx, segment);
  }
}

function patchTrailingRun(
  runs: (TextRun | InlineAtom | RubyAnnotation)[],
  runIdx: number,
  segment: StyledSegment,
): void {
  const run = runs[runIdx];
  if (!run || run.type !== 'text-run') return;
  let patched: TextRun = run;
  if (segment.borderEnd)
    patched = { ...patched, paint: withTrailingEndEdge(patched.paint, segment.style) };
  if (segment.inlineMarginRight)
    patched = { ...patched, inlineMarginRight: segment.inlineMarginRight };
  runs[runIdx] = patched;
}
