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
  // Track segments that have already emitted runs to prevent duplicate borderStart
  const startedSegments = new Set<StyledSegment>();
  // Track last-run location per segment for post-hoc trailing-edge markers
  // (borderEnd, inlineMarginRight). The map records the most recently emitted
  // run for each segment; the final post-pass stamps markers onto that run.
  const trailingEdgeTracker = new Map<StyledSegment, RunLocation>();

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
      startedSegments,
      trailingEdgeTracker,
      lines.length,
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

  // Apply trailing-edge markers (borderEnd, inlineMarginRight) to the
  // last emitted run of each segment. Tracker uses segment identity as key
  // so post-hoc markers can't drift onto an earlier slice of the same segment.
  for (const [segment, loc] of trailingEdgeTracker) {
    const line = lines[loc.lineIdx];
    if (!line) continue;
    const runs = line.runs as Run[];
    const run = runs[loc.runIdx];
    if (run && run.type === 'text-run') {
      let patched = run;
      if (segment.borderEnd) patched = { ...patched, borderEnd: true };
      if (segment.inlineMarginRight) {
        patched = { ...patched, inlineMarginRight: segment.inlineMarginRight };
      }
      runs[loc.runIdx] = patched;
    }
  }

  return lines;
}

/** Tracks the location of the last run emitted for each borderEnd segment. */
interface RunLocation {
  lineIdx: number;
  runIdx: number;
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
  startedSegments: Set<StyledSegment>,
  trailingEdgeTracker: Map<StyledSegment, RunLocation>,
  lineIdx: number,
): Run[] {
  const ctx: RunBuildContext = {
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
  /** Segments that have already emitted at least one run (cross-line tracking). */
  startedSegments: Set<StyledSegment>;
  /** Last-run location per segment carrying a trailing-edge marker
   *  (borderEnd and/or inlineMarginRight) — stamped post-hoc. */
  trailingEdgeTracker: Map<StyledSegment, RunLocation>;
  /** Current line index (for trailingEdgeTracker). */
  lineIdx: number;
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
    ctx.currentSegment.rubyAnnotation === segment.rubyAnnotation &&
    // Don't merge across border fragment boundaries: if the current segment
    // ends a bordered inline or the new one starts one, keep them separate
    // so borderStart/borderEnd markers stay on the correct runs.
    !ctx.currentSegment.borderEnd &&
    !segment.borderStart
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

  // Only mark borderStart on the very first run of this segment (across all lines).
  const isFirst = !ctx.startedSegments.has(ctx.currentSegment);
  if (isFirst) ctx.startedSegments.add(ctx.currentSegment);
  const isStart = ctx.currentSegment.borderStart === true && isFirst;

  // Compute inline border+padding+margin insets so runs don't overlap
  const marginLeft = isFirst ? (ctx.currentSegment.inlineMarginLeft ?? 0) : 0;
  const insetLeft = (isStart ? style.borderLeft.width + style.paddingLeft : 0) + marginLeft;
  if (insetLeft > 0) ctx.x += insetLeft;

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
  if (isStart) run = { ...run, borderStart: true };
  ctx.runs.push(run);
  // Record latest run for each segment (last writer wins after all lines
  // are built). Trailing-edge markers (borderEnd, inlineMarginRight) are
  // stamped onto this run by the post-pass in buildLineBoxes — never here,
  // so intermediate slices of a cross-line segment stay clean.
  if (ctx.currentSegment.borderEnd || ctx.currentSegment.inlineMarginRight) {
    ctx.trailingEdgeTracker.set(ctx.currentSegment, {
      lineIdx: ctx.lineIdx,
      runIdx: ctx.runs.length - 1,
    });
  }
  ctx.x += width;

  // Add right inset — reserve space for trailing border/padding/margin so
  // subsequent runs are positioned after the inline box's right edge. When
  // the segment continues on a later line, ctx is discarded at line end and
  // the extra x is harmless; the tracker stamps the final marker elsewhere.
  if (ctx.currentSegment.borderEnd) {
    ctx.x += style.paddingRight + style.borderRight.width;
  }
  if (ctx.currentSegment.inlineMarginRight) {
    ctx.x += ctx.currentSegment.inlineMarginRight;
  }

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
