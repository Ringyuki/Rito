import type { ComputedStyle } from '../../../style/core/types';
import type { InlineAtom, LineBox, TextRun } from '../../core/types';
import type { ParagraphLayouter } from '../../text/paragraph-layouter';
import type { InlineAtomSegment, InlineSegment, StyledSegment } from '../../text/styled-segment';
import { isInlineAtom } from '../../text/styled-segment';
import { applyAlign, computeEffectiveLineMetrics, shiftRunsY } from '../../text/text-align';
import type { TextMeasurer } from '../../text/text-measurer';
import { buildKPItems } from './builder';
import { emergencyBreaks, solveKP } from './solver';
import type { KPItem } from './types';

export function createKnuthPlassLayouter(measurer: TextMeasurer): ParagraphLayouter {
  return {
    layoutParagraph(
      segments: readonly InlineSegment[],
      maxWidth: number,
      startY: number,
    ): readonly LineBox[] {
      if (segments.length === 0) return [];
      const firstStyle = segments[0]?.style;
      if (!firstStyle) return [];

      const hasAtoms = segments.some(isInlineAtom);
      const fullText = segments.map((s) => (isInlineAtom(s) ? '\uFFFC' : s.text)).join('');
      if (fullText.trim().length === 0 && !fullText.includes('\n') && !hasAtoms) return [];

      const lineHeight = firstStyle.lineHeightPx ?? firstStyle.fontSize * firstStyle.lineHeight;
      const indent = firstStyle.textIndent;
      const items = buildKPItems(segments, measurer);
      if (items.length === 0) return [];

      const effectiveWidth = indent !== 0 ? maxWidth - indent : maxWidth;
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
  const baseFontSize = baseStyle.fontSize;

  for (let lineIndex = 0; lineIndex < breakPositions.length; lineIndex++) {
    const breakPos = breakPositions[lineIndex];
    if (breakPos === undefined) continue;
    const isFirstLine = lineIndex === 0;
    const isLastLine = lineIndex === breakPositions.length - 1;
    const startX = isFirstLine && indent !== 0 ? indent : 0;
    const runs = buildLineRuns(
      items,
      lineStart,
      breakPos,
      startX,
      lineHeight,
      measurer,
      baseFontSize,
    );

    if (runs.length > 0) {
      const lineWidth = runs.reduce(
        (currentMax, run) => Math.max(currentMax, run.bounds.x + run.bounds.width),
        0,
      );
      const { height: effectiveLH, yShift } = computeEffectiveLineMetrics(runs, lineHeight);
      shiftRunsY(runs, yShift);
      lines.push(
        applyAlign(runs, lineWidth, y, effectiveLH, maxWidth, baseStyle.textAlign, isLastLine),
      );
      y += effectiveLH;
    }

    lineStart = breakPos + 1;
  }

  return lines;
}

type Run = TextRun | InlineAtom;

function buildLineRuns(
  items: readonly KPItem[],
  startIdx: number,
  endIdx: number,
  startX: number,
  lineHeight: number,
  measurer: TextMeasurer,
  baseFontSize: number,
): Run[] {
  const ctx: RunBuildContext = {
    runs: [],
    x: startX,
    currentText: '',
    currentSegment: undefined,
    currentSourceOffset: 0,
    hasTrailingHyphen: false,
    baseFontSize,
  };

  let index = skipLeadingNonContent(items, startIdx, endIdx);
  for (; index < endIdx; index++) {
    const item = items[index];
    if (!item) continue;

    if (item.type === 'box' && item.atom) {
      flushRun(ctx, lineHeight, measurer);
      ctx.runs.push(buildAtomRun(item.atom, ctx.x, lineHeight, baseFontSize));
      ctx.x += item.atom.width;
    } else if (item.type === 'box') {
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
  runs: Run[];
  x: number;
  currentText: string;
  currentSegment: StyledSegment | undefined;
  /** Offset of currentText[0] within the current segment's source text node. */
  currentSourceOffset: number;
  /** Whether appendHyphenIfNeeded added an artificial '-' to currentText. */
  hasTrailingHyphen: boolean;
  /** Paragraph base font size for baseline alignment. */
  baseFontSize: number;
}

function appendBox(
  ctx: RunBuildContext,
  text: string,
  segment: StyledSegment,
  lineHeight: number,
  measurer: TextMeasurer,
): void {
  if (
    ctx.currentSegment?.style === segment.style &&
    ctx.currentSegment.href === segment.href &&
    ctx.currentSegment.rubyAnnotation === segment.rubyAnnotation
  ) {
    ctx.currentText += text;
    return;
  }

  flushRun(ctx, lineHeight, measurer);
  ctx.currentSegment = segment;
  ctx.currentText = text;
  ctx.currentSourceOffset = 0;
}

function flushRun(ctx: RunBuildContext, lineHeight: number, measurer: TextMeasurer): void {
  if (ctx.currentText.length === 0 || !ctx.currentSegment) return;

  const style = ctx.currentSegment.style;
  const href = ctx.currentSegment.href;
  const ruby = ctx.currentSegment.rubyAnnotation;
  const flushedLength = ctx.currentText.length;
  const width = measurer.measureText(ctx.currentText, style).width;

  const runY = computeVerticalAlignOffset(style, lineHeight, ctx.baseFontSize);
  const runHeight = style.lineHeightPx ?? style.fontSize * style.lineHeight;

  let run: TextRun = {
    type: 'text-run',
    text: ctx.currentText,
    bounds: { x: ctx.x, y: runY, width, height: runHeight },
    style,
    ...(ctx.currentSegment.sourceRef ? { sourceRef: ctx.currentSegment.sourceRef } : {}),
    ...(ctx.currentSegment.sourceText !== undefined
      ? { sourceText: ctx.currentSegment.sourceText }
      : {}),
    ...(ctx.currentSegment.sourceRef ? { sourceTextOffset: ctx.currentSourceOffset } : {}),
  };
  if (href) run = { ...run, href };
  if (ruby) run = { ...run, rubyAnnotation: ruby };
  ctx.runs.push(run);
  ctx.x += width;
  const sourceLength = ctx.hasTrailingHyphen ? flushedLength - 1 : flushedLength;
  ctx.currentSourceOffset += sourceLength;
  ctx.currentText = '';
  ctx.hasTrailingHyphen = false;
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
    ctx.hasTrailingHyphen = true;
  }
}

function trimLastRun(runs: Run[], measurer: TextMeasurer): void {
  const lastRun = runs[runs.length - 1];
  if (!lastRun || lastRun.type !== 'text-run') return;

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

function buildAtomRun(
  atom: InlineAtomSegment,
  x: number,
  lineHeight: number,
  baseFontSize: number,
): InlineAtom {
  const base: InlineAtom = {
    type: 'inline-atom',
    bounds: {
      x,
      y: computeVerticalAlignOffset(atom.style, lineHeight, baseFontSize),
      width: atom.width,
      height: atom.height,
    },
  };
  if (atom.imageSrc !== undefined) {
    let withSrc: InlineAtom = { ...base, imageSrc: atom.imageSrc };
    if (atom.alt) withSrc = { ...withSrc, alt: atom.alt };
    if (atom.href) withSrc = { ...withSrc, href: atom.href };
    return withSrc;
  }
  if (atom.sourceNode) return { ...base, verticalAlign: atom.style.verticalAlign };
  return base;
}

const ASCENT_RATIO = 0.8;

function computeVerticalAlignOffset(
  style: ComputedStyle,
  lineHeight: number,
  baseFontSize: number,
): number {
  const verticalAlign = style.verticalAlign;
  switch (verticalAlign) {
    case 'baseline': {
      return ASCENT_RATIO * (baseFontSize - style.fontSize);
    }
    case 'top':
    case 'text-top':
      return 0;
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
