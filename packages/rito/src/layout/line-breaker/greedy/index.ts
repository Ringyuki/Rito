import type { ComputedStyle } from '../../../style/core/types';
import type { InlineAtom, LineBox, TextRun } from '../../core/types';
import type { ParagraphLayouter } from '../../text/paragraph-layouter';
import type { InlineAtomSegment, InlineSegment } from '../../text/styled-segment';
import { applyAlign, computeEffectiveLineMetrics, shiftRunsY } from '../../text/text-align';
import type { TextMeasurer } from '../../text/text-measurer';
import { findBreakPosition } from './breaks';
import { buildLineContext, buildStyleRanges, consumeNewlines } from './context';
import { buildStyledRuns, getRunsWidth } from './runs';
import type { LineContext, StyleRange } from './types';

export function createGreedyLayouter(measurer: TextMeasurer): ParagraphLayouter {
  return {
    layoutParagraph(
      segments: readonly InlineSegment[],
      maxWidth: number,
      startY: number,
    ): readonly LineBox[] {
      if (segments.length === 0) return [];
      const firstStyle = segments[0]?.style;
      if (!firstStyle) return [];

      const { fullText, ranges, atoms } = buildStyleRanges(segments);
      if (fullText.trim().length === 0 && !fullText.includes('\n') && atoms.size === 0) return [];

      return layoutText(fullText, firstStyle, ranges, maxWidth, startY, measurer, atoms);
    },
  };
}

function layoutText(
  text: string,
  baseStyle: ComputedStyle,
  ranges: readonly StyleRange[],
  maxWidth: number,
  startY: number,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment> = new Map(),
): LineBox[] {
  const ctx = buildLineContext(text, baseStyle, ranges, maxWidth, measurer, atoms);
  const { lineHeight } = ctx;
  const indent = baseStyle.textIndent;
  const lines: LineBox[] = [];
  let y = startY;
  let pos = 0;
  let isFirstLine = true;

  while (pos < text.length) {
    if (!ctx.preserveWs && (!isFirstLine || indent <= 0)) {
      while (pos < text.length && text[pos] === ' ') pos++;
    }
    if (pos >= text.length) break;

    const result = layoutSingleLine(ctx, pos, isFirstLine, indent);
    pos = consumeNewlines(text, result.nextPos, ctx.preserveWs);
    const isLastLine = pos >= text.length;
    const { height: effectiveLH, yShift } = computeEffectiveLineMetrics(result.runs, lineHeight);
    shiftRunsY(result.runs, yShift);
    lines.push(
      applyAlign(
        result.runs,
        result.width,
        y,
        effectiveLH,
        maxWidth,
        baseStyle.textAlign,
        isLastLine,
      ),
    );
    y += effectiveLH;
    isFirstLine = false;
  }

  return lines;
}

function layoutSingleLine(
  ctx: LineContext,
  pos: number,
  isFirstLine: boolean,
  indent: number,
): { runs: (TextRun | InlineAtom)[]; width: number; nextPos: number } {
  const { text, maxWidth, preserveWs, allowWrap, baseStyle, ranges, lineHeight, measurer, atoms } =
    ctx;
  const effectiveMax = isFirstLine && indent !== 0 ? maxWidth - indent : maxWidth;
  const lineStartX = isFirstLine && indent !== 0 ? indent : 0;
  const newlineIndex = text.indexOf('\n', pos);
  const lineEnd = newlineIndex >= 0 ? newlineIndex : text.length;
  const breakPos = allowWrap
    ? findBreakPosition(text, pos, lineEnd, effectiveMax, baseStyle, measurer, atoms)
    : lineEnd;
  const lineTextEnd = breakPos <= pos ? pos + 1 : breakPos;
  const lineText = preserveWs
    ? text.slice(pos, lineTextEnd)
    : text.slice(pos, lineTextEnd).trimEnd();
  const runs = buildStyledRuns(
    lineText,
    pos,
    lineStartX,
    lineHeight,
    ranges,
    measurer,
    atoms,
    baseStyle.fontSize,
  );

  return { runs, width: getRunsWidth(runs), nextPos: lineTextEnd };
}
