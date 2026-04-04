import type { ComputedStyle } from '../../../style/core/types';
import type { LineBox, TextRun } from '../../core/types';
import type { ParagraphLayouter } from '../../text/paragraph-layouter';
import type { StyledSegment } from '../../text/styled-segment';
import { applyAlign } from '../../text/text-align';
import type { TextMeasurer } from '../../text/text-measurer';
import { buildKPItems } from './builder';
import { emergencyBreaks, solveKP } from './solver';
import type { KPItem } from './types';

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

      const fullText = segments.map((segment) => segment.text).join('');
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

  for (let lineIndex = 0; lineIndex < breakPositions.length; lineIndex++) {
    const breakPos = breakPositions[lineIndex];
    if (breakPos === undefined) continue;
    const isFirstLine = lineIndex === 0;
    const isLastLine = lineIndex === breakPositions.length - 1;
    const startX = isFirstLine && indent > 0 ? indent : 0;
    const runs = buildLineRuns(items, lineStart, breakPos, startX, lineHeight, measurer);

    if (runs.length > 0) {
      const lineWidth = runs.reduce(
        (currentMax, run) => Math.max(currentMax, run.bounds.x + run.bounds.width),
        0,
      );
      lines.push(
        applyAlign(runs, lineWidth, y, lineHeight, maxWidth, baseStyle.textAlign, isLastLine),
      );
      y += lineHeight;
    }

    lineStart = breakPos + 1;
  }

  return lines;
}

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

  let index = skipLeadingNonContent(items, startIdx, endIdx);
  for (; index < endIdx; index++) {
    const item = items[index];
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
  if (ctx.currentSegment?.style === segment.style) {
    ctx.currentText += text;
    return;
  }

  flushRun(ctx, lineHeight, measurer);
  ctx.currentSegment = segment;
  ctx.currentText = text;
}

function flushRun(ctx: RunBuildContext, lineHeight: number, measurer: TextMeasurer): void {
  if (ctx.currentText.length === 0 || !ctx.currentSegment) return;

  const style = ctx.currentSegment.style;
  const width = measurer.measureText(ctx.currentText, style).width;
  ctx.runs.push({
    type: 'text-run',
    text: ctx.currentText,
    bounds: {
      x: ctx.x,
      y: computeVerticalAlignOffset(style, lineHeight),
      width,
      height: lineHeight,
    },
    style,
  });
  ctx.x += width;
  ctx.currentText = '';
}

function skipLeadingNonContent(items: readonly KPItem[], start: number, end: number): number {
  let index = start;
  while (index < end && items[index]?.type === 'glue') index++;
  while (index < end && items[index]?.type === 'penalty') index++;
  return index;
}

function appendHyphenIfNeeded(
  ctx: RunBuildContext,
  items: readonly KPItem[],
  endIdx: number,
): void {
  const breakItem = items[endIdx];
  if (
    breakItem?.type === 'penalty' &&
    breakItem.flagged &&
    isFinite(breakItem.penalty) &&
    ctx.currentSegment
  ) {
    ctx.currentText += '-';
  }
}

function trimLastRun(runs: TextRun[], measurer: TextMeasurer): void {
  const lastRun = runs[runs.length - 1];
  if (!lastRun) return;

  const trimmed = lastRun.text.trimEnd();
  if (trimmed.length === lastRun.text.length) return;

  runs[runs.length - 1] = {
    ...lastRun,
    text: trimmed,
    bounds: {
      ...lastRun.bounds,
      width: measurer.measureText(trimmed, lastRun.style).width,
    },
  };
}

function computeVerticalAlignOffset(style: ComputedStyle, lineHeight: number): number {
  const verticalAlign = style.verticalAlign;
  if (verticalAlign === 'baseline' || verticalAlign === 'top' || verticalAlign === 'text-top') {
    return 0;
  }

  switch (verticalAlign) {
    case 'super':
      return -(style.fontSize * 0.4);
    case 'sub':
      return style.fontSize * 0.2;
    case 'middle':
      return (lineHeight - style.fontSize) / 2;
    case 'bottom':
    case 'text-bottom':
      return lineHeight - style.fontSize;
    default:
      return 0;
  }
}
