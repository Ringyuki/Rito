/**
 * Knuth-Plass optimal line breaker.
 *
 * Implements the ParagraphLayouter interface using the Knuth-Plass algorithm
 * to produce lines with more even spacing than the greedy approach.
 */

import type { ComputedStyle } from '../style/types';
import { buildKPItems } from './kp-builder';
import type { KPItem } from './kp-types';
import { emergencyBreaks, solveKP } from './kp-solver';
import type { ParagraphLayouter } from './paragraph-layouter';
import type { StyledSegment } from './styled-segment';
import { applyAlign } from './text-align';
import type { TextMeasurer } from './text-measurer';
import type { LineBox, TextRun } from './types';

/**
 * Create a ParagraphLayouter that uses the Knuth-Plass optimal
 * line-breaking algorithm.
 */
export function createKnuthPlassLayouter(measurer: TextMeasurer): ParagraphLayouter {
  return {
    layoutParagraph(
      segments: readonly StyledSegment[],
      maxWidth: number,
      startY: number,
    ): readonly LineBox[] {
      if (segments.length === 0) return [];
      const firstStyle = segments[0]?.style;
      if (!firstStyle) return [];
      const fullText = segments.map((s) => s.text).join('');
      if (fullText.trim().length === 0) return [];

      const lineHeight = firstStyle.fontSize * firstStyle.lineHeight;
      const indent = firstStyle.textIndent;
      const items = buildKPItems(segments, measurer);
      if (items.length === 0) return [];

      const effectiveWidth = indent > 0 ? maxWidth - indent : maxWidth;
      const breakPositions =
        solveKP(items, effectiveWidth) ?? emergencyBreaks(items, effectiveWidth);

      return buildLineBoxes(
        items,
        breakPositions,
        maxWidth,
        indent,
        startY,
        lineHeight,
        firstStyle,
        measurer,
      );
    },
  };
}

/** Build LineBox array from KP items and break positions. */
function buildLineBoxes(
  items: readonly KPItem[],
  breakPositions: readonly number[],
  maxWidth: number,
  indent: number,
  startY: number,
  lineHeight: number,
  baseStyle: ComputedStyle,
  measurer: TextMeasurer,
): LineBox[] {
  const lines: LineBox[] = [];
  let lineStart = 0;
  let y = startY;

  for (let lineIdx = 0; lineIdx < breakPositions.length; lineIdx++) {
    const breakPos = breakPositions[lineIdx];
    if (breakPos === undefined) continue;
    const isFirstLine = lineIdx === 0;
    const isLastLine = lineIdx === breakPositions.length - 1;
    const startX = isFirstLine && indent > 0 ? indent : 0;

    const lineRuns = buildLineRuns(items, lineStart, breakPos, startX, lineHeight, measurer);

    if (lineRuns.length > 0) {
      const lineWidth = lineRuns.reduce((sum, r) => Math.max(sum, r.bounds.x + r.bounds.width), 0);
      lines.push(
        applyAlign(lineRuns, lineWidth, y, lineHeight, maxWidth, baseStyle.textAlign, isLastLine),
      );
      y += lineHeight;
    }

    lineStart = breakPos + 1;
  }

  return lines;
}

/** Build TextRun array for a single line from KP items. */
function buildLineRuns(
  items: readonly KPItem[],
  startIdx: number,
  endIdx: number,
  startX: number,
  lineHeight: number,
  measurer: TextMeasurer,
): TextRun[] {
  const ctx: RunBuildContext = {
    runs: [],
    x: startX,
    currentText: '',
    currentSegment: undefined,
  };

  let i = skipLeadingNonContent(items, startIdx, endIdx);

  for (; i < endIdx; i++) {
    const item = items[i];
    if (!item) continue;
    if (item.type === 'box') {
      appendBox(ctx, item.text, item.segment, lineHeight, measurer);
    } else if (item.type === 'glue' && ctx.currentSegment) {
      ctx.currentText += ' ';
    }
  }

  appendHyphenIfNeeded(ctx, items, endIdx);
  flushRun(ctx, lineHeight, measurer);
  trimLastRun(ctx.runs, measurer);

  return ctx.runs;
}

interface RunBuildContext {
  runs: TextRun[];
  x: number;
  currentText: string;
  currentSegment: StyledSegment | undefined;
}

function appendBox(
  ctx: RunBuildContext,
  text: string,
  segment: StyledSegment,
  lineHeight: number,
  measurer: TextMeasurer,
): void {
  if (ctx.currentSegment && ctx.currentSegment.style === segment.style) {
    ctx.currentText += text;
  } else {
    flushRun(ctx, lineHeight, measurer);
    ctx.currentSegment = segment;
    ctx.currentText = text;
  }
}

function flushRun(ctx: RunBuildContext, lineHeight: number, measurer: TextMeasurer): void {
  if (ctx.currentText.length === 0 || !ctx.currentSegment) return;
  const style = ctx.currentSegment.style;
  const width = measurer.measureText(ctx.currentText, style).width;
  const yOffset = computeVerticalAlignOffset(style, lineHeight);
  ctx.runs.push({
    type: 'text-run',
    text: ctx.currentText,
    bounds: { x: ctx.x, y: yOffset, width, height: lineHeight },
    style,
  });
  ctx.x += width;
  ctx.currentText = '';
}

function skipLeadingNonContent(items: readonly KPItem[], start: number, end: number): number {
  let i = start;
  while (i < end && items[i]?.type === 'glue') i++;
  while (i < end && items[i]?.type === 'penalty') i++;
  return i;
}

function appendHyphenIfNeeded(
  ctx: RunBuildContext,
  items: readonly KPItem[],
  endIdx: number,
): void {
  const breakItem = items[endIdx];
  if (breakItem?.type === 'penalty' && breakItem.flagged && isFinite(breakItem.penalty)) {
    if (ctx.currentSegment) ctx.currentText += '-';
  }
}

function trimLastRun(runs: TextRun[], measurer: TextMeasurer): void {
  if (runs.length === 0) return;
  const lastRun = runs[runs.length - 1];
  if (!lastRun) return;
  const trimmed = lastRun.text.trimEnd();
  if (trimmed.length < lastRun.text.length) {
    const w = measurer.measureText(trimmed, lastRun.style).width;
    runs[runs.length - 1] = {
      ...lastRun,
      text: trimmed,
      bounds: { ...lastRun.bounds, width: w },
    };
  }
}

/** Compute vertical y-offset for a text run based on vertical-align. */
function computeVerticalAlignOffset(style: ComputedStyle, lineHeight: number): number {
  const va = style.verticalAlign;
  if (va === 'baseline' || va === 'top' || va === 'text-top') return 0;
  const fontSize = style.fontSize;
  switch (va) {
    case 'super':
      return -(fontSize * 0.4);
    case 'sub':
      return fontSize * 0.2;
    case 'middle':
      return (lineHeight - fontSize) / 2;
    case 'bottom':
    case 'text-bottom':
      return lineHeight - fontSize;
    default:
      return 0;
  }
}
