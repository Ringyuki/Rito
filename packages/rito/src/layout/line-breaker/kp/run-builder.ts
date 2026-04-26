import type { ComputedStyle } from '../../../style/core/types';
import { measurePaintFromStyle } from '../../../style/css/font-shorthand';
import type { InlineAtom, TextRun } from '../../core/types';
import type { InlineAtomSegment, StyledSegment } from '../../text/styled-segment';
import { runPaintFromStyle } from '../../text/run-paint-from-style';
import type { TextMeasurer } from '../../text/text-measurer';
import { attachRuby } from '../greedy/runs';
import type { KPItem } from './types';

export interface RunLocation {
  readonly lineIdx: number;
  readonly runIdx: number;
}

export type Run = TextRun | InlineAtom;

interface RunBuildContext {
  readonly runs: Run[];
  x: number;
  currentText: string;
  currentSegment: StyledSegment | undefined;
  currentSourceOffset: number;
  hasTrailingHyphen: boolean;
  readonly baseFontSize: number;
  readonly startedSegments: Set<StyledSegment>;
  readonly trailingEdgeTracker: Map<StyledSegment, RunLocation>;
  readonly lineIdx: number;
}

export function buildLineRuns(
  items: readonly KPItem[],
  startIdx: number,
  endIdx: number,
  startX: number,
  lineHeight: number,
  measurer: TextMeasurer,
  baseFontSize: number,
  startedSegments: Set<StyledSegment>,
  trailingEdgeTracker: Map<StyledSegment, RunLocation>,
  lineIdx: number,
): Run[] {
  const ctx = createRunBuildContext(
    startX,
    baseFontSize,
    startedSegments,
    trailingEdgeTracker,
    lineIdx,
  );
  let index = skipLeadingNonContent(items, startIdx, endIdx);
  for (; index < endIdx; index++) {
    appendItem(ctx, items[index], lineHeight, measurer);
  }
  appendHyphenIfNeeded(ctx, items, endIdx);
  flushRun(ctx, lineHeight, measurer);
  trimLastRun(ctx.runs, measurer);
  return ctx.runs;
}

function createRunBuildContext(
  startX: number,
  baseFontSize: number,
  startedSegments: Set<StyledSegment>,
  trailingEdgeTracker: Map<StyledSegment, RunLocation>,
  lineIdx: number,
): RunBuildContext {
  return {
    runs: [],
    x: startX,
    currentText: '',
    currentSegment: undefined,
    currentSourceOffset: 0,
    hasTrailingHyphen: false,
    baseFontSize,
    startedSegments,
    trailingEdgeTracker,
    lineIdx,
  };
}

function appendItem(
  ctx: RunBuildContext,
  item: KPItem | undefined,
  lineHeight: number,
  measurer: TextMeasurer,
): void {
  if (!item) return;
  if (item.type === 'box' && item.atom) {
    flushRun(ctx, lineHeight, measurer);
    ctx.runs.push(buildAtomRun(item.atom, ctx.x, lineHeight, ctx.baseFontSize));
    ctx.x += item.atom.width;
  } else if (item.type === 'box') {
    appendBox(ctx, item.text, item.segment, lineHeight, measurer);
  } else if (item.type === 'glue' && ctx.currentSegment) {
    ctx.currentText += item.text;
  }
}

function appendBox(
  ctx: RunBuildContext,
  text: string,
  segment: StyledSegment,
  lineHeight: number,
  measurer: TextMeasurer,
): void {
  if (text.length > 0 && canMergeBox(ctx.currentSegment, segment)) {
    ctx.currentText += text;
    return;
  }
  flushRun(ctx, lineHeight, measurer);
  ctx.currentSegment = segment;
  ctx.currentText = text;
  ctx.currentSourceOffset = 0;
}

function canMergeBox(current: StyledSegment | undefined, next: StyledSegment): boolean {
  if (current === next) return true;
  return (
    current?.style === next.style &&
    current.href === next.href &&
    current.rubyAnnotation === next.rubyAnnotation &&
    !current.borderEnd &&
    !next.borderStart
  );
}

function flushRun(ctx: RunBuildContext, lineHeight: number, measurer: TextMeasurer): void {
  const segment = ctx.currentSegment;
  if (ctx.currentText.length === 0 || !segment) return;

  const flushedLength = ctx.currentText.length;
  const isFirst = markSegmentStarted(ctx, segment);
  const isStart = segment.borderStart === true && isFirst;
  ctx.x += getLeadingInset(segment, isStart, isFirst);

  const run = buildTextRun(ctx, segment, isStart, lineHeight, measurer);
  ctx.runs.push(run);
  recordTrailingEdge(ctx, segment);
  ctx.x += run.bounds.width + getTrailingInset(segment);
  advanceFlushState(ctx, flushedLength);
}

function markSegmentStarted(ctx: RunBuildContext, segment: StyledSegment): boolean {
  const isFirst = !ctx.startedSegments.has(segment);
  if (isFirst) ctx.startedSegments.add(segment);
  return isFirst;
}

function getLeadingInset(segment: StyledSegment, isStart: boolean, isFirst: boolean): number {
  const marginLeft = isFirst ? (segment.inlineMarginLeft ?? 0) : 0;
  return (isStart ? segment.style.borderLeft.width + segment.style.paddingLeft : 0) + marginLeft;
}

function buildTextRun(
  ctx: RunBuildContext,
  segment: StyledSegment,
  isStart: boolean,
  lineHeight: number,
  measurer: TextMeasurer,
): TextRun {
  const style = segment.style;
  const width = measurer.measureText(ctx.currentText, measurePaintFromStyle(style)).width;
  let run: TextRun = {
    type: 'text-run',
    text: ctx.currentText,
    bounds: {
      x: ctx.x,
      y: computeVerticalAlignOffset(style, lineHeight, ctx.baseFontSize),
      width,
      height: style.lineHeightPx ?? style.fontSize * style.lineHeight,
    },
    paint: runPaintFromStyle(style, { start: isStart, end: false }),
    ...(style.lineHeightPx !== undefined ? { lineHeightPx: style.lineHeightPx } : {}),
    ...(segment.sourceRef ? { sourceRef: segment.sourceRef } : {}),
    ...(segment.sourceText !== undefined ? { sourceText: segment.sourceText } : {}),
    ...(segment.sourceRef ? { sourceTextOffset: ctx.currentSourceOffset } : {}),
  };
  if (segment.href) run = { ...run, href: segment.href };
  if (segment.rubyAnnotation) attachRuby(run, segment.rubyAnnotation);
  return run;
}

function recordTrailingEdge(ctx: RunBuildContext, segment: StyledSegment): void {
  if (!segment.borderEnd && !segment.inlineMarginRight) return;
  ctx.trailingEdgeTracker.set(segment, {
    lineIdx: ctx.lineIdx,
    runIdx: ctx.runs.length - 1,
  });
}

function getTrailingInset(segment: StyledSegment): number {
  let inset = segment.borderEnd ? segment.style.paddingRight + segment.style.borderRight.width : 0;
  if (segment.inlineMarginRight) inset += segment.inlineMarginRight;
  return inset;
}

function advanceFlushState(ctx: RunBuildContext, flushedLength: number): void {
  ctx.currentSourceOffset += ctx.hasTrailingHyphen ? flushedLength - 1 : flushedLength;
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
    bounds: trimRunBounds(lastRun, trimmed, measurer),
  };
}

function trimRunBounds(run: TextRun, trimmed: string, measurer: TextMeasurer): TextRun['bounds'] {
  const paint = {
    font: run.paint.font,
    ...(run.paint.wordSpacingPx !== undefined ? { wordSpacingPx: run.paint.wordSpacingPx } : {}),
  };
  return { ...run.bounds, width: measurer.measureText(trimmed, paint).width };
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
  return base;
}

const ASCENT_RATIO = 0.8;

function computeVerticalAlignOffset(
  style: ComputedStyle,
  lineHeight: number,
  baseFontSize: number,
): number {
  switch (style.verticalAlign) {
    case 'baseline':
      return ASCENT_RATIO * (baseFontSize - style.fontSize);
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
