import type { ComputedStyle } from '../style/types';
import { findHyphenationPoints } from './hyphenation';
import { applyAlign } from './text-align';
import type { LineBox, TextRun } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import type { StyledSegment } from './styled-segment';
import type { TextMeasurer } from './text-measurer';

const CJK_RE =
  /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}\u3000-\u303F\uFF00-\uFFEF]/u;

interface StyleRange {
  readonly start: number;
  readonly end: number;
  readonly style: ComputedStyle;
}

interface LineContext {
  readonly text: string;
  readonly baseStyle: ComputedStyle;
  readonly ranges: readonly StyleRange[];
  readonly maxWidth: number;
  readonly lineHeight: number;
  readonly measurer: TextMeasurer;
  readonly preserveWs: boolean;
  readonly allowWrap: boolean;
}

export function createGreedyLayouter(measurer: TextMeasurer): ParagraphLayouter {
  return {
    layoutParagraph(
      segments: readonly StyledSegment[],
      maxWidth: number,
      startY: number,
    ): readonly LineBox[] {
      if (segments.length === 0) return [];
      const firstStyle = segments[0]?.style;
      if (!firstStyle) return [];

      const ranges: StyleRange[] = [];
      let offset = 0;
      for (const seg of segments) {
        if (seg.text.length > 0) {
          ranges.push({ start: offset, end: offset + seg.text.length, style: seg.style });
          offset += seg.text.length;
        }
      }
      const fullText = segments.map((s) => s.text).join('');
      if (fullText.trim().length === 0) return [];

      return layoutText(fullText, firstStyle, ranges, maxWidth, startY, measurer);
    },
  };
}

function buildLineContext(
  text: string,
  baseStyle: ComputedStyle,
  ranges: readonly StyleRange[],
  maxWidth: number,
  measurer: TextMeasurer,
): LineContext {
  return {
    text,
    baseStyle,
    ranges,
    maxWidth,
    lineHeight: baseStyle.fontSize * baseStyle.lineHeight,
    measurer,
    preserveWs: baseStyle.whiteSpace === 'pre' || baseStyle.whiteSpace === 'pre-wrap',
    allowWrap: baseStyle.whiteSpace !== 'pre' && baseStyle.whiteSpace !== 'nowrap',
  };
}

function layoutText(
  text: string,
  baseStyle: ComputedStyle,
  ranges: readonly StyleRange[],
  maxWidth: number,
  startY: number,
  measurer: TextMeasurer,
): LineBox[] {
  const ctx = buildLineContext(text, baseStyle, ranges, maxWidth, measurer);
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
    lines.push(
      applyAlign(
        result.runs,
        result.width,
        y,
        lineHeight,
        maxWidth,
        baseStyle.textAlign,
        isLastLine,
      ),
    );
    y += lineHeight;
    isFirstLine = false;
  }

  return lines;
}

function layoutSingleLine(
  ctx: LineContext,
  pos: number,
  isFirstLine: boolean,
  indent: number,
): { runs: TextRun[]; width: number; nextPos: number } {
  const { text, maxWidth, preserveWs, allowWrap, baseStyle, ranges, lineHeight, measurer } = ctx;
  const effectiveMax = isFirstLine && indent > 0 ? maxWidth - indent : maxWidth;
  const lineStartX = isFirstLine && indent > 0 ? indent : 0;
  const nlIndex = text.indexOf('\n', pos);
  const lineEnd = nlIndex >= 0 ? nlIndex : text.length;
  const breakPos = allowWrap
    ? findBreakPosition(text, pos, lineEnd, effectiveMax, baseStyle, measurer)
    : lineEnd;
  const lineTextEnd = breakPos <= pos ? pos + 1 : breakPos;
  const lineText = preserveWs
    ? text.slice(pos, lineTextEnd)
    : text.slice(pos, lineTextEnd).trimEnd();
  const runs = buildStyledRuns(lineText, pos, lineStartX, lineHeight, ranges, measurer);
  const width = runs.reduce((sum, r) => Math.max(sum, r.bounds.x + r.bounds.width), 0);
  return { runs, width, nextPos: lineTextEnd };
}

function consumeNewlines(text: string, pos: number, preserveWs: boolean): number {
  if (preserveWs) {
    return pos < text.length && text[pos] === '\n' ? pos + 1 : pos;
  }
  while (pos < text.length && text[pos] === '\n') pos++;
  return pos;
}

function buildStyledRuns(
  lineText: string,
  globalOffset: number,
  startX: number,
  lineHeight: number,
  ranges: readonly StyleRange[],
  measurer: TextMeasurer,
): TextRun[] {
  const runs: TextRun[] = [];
  let x = startX;
  let linePos = 0;

  while (linePos < lineText.length) {
    const globalPos = globalOffset + linePos;
    const range = findRange(ranges, globalPos);
    if (!range) break;

    const rangeEnd = Math.min(range.end - globalOffset, lineText.length);
    const runText = lineText.slice(linePos, rangeEnd);
    if (runText.length === 0) break;

    const width = measurer.measureText(runText, range.style).width;
    const yOffset = computeVerticalAlignOffset(range.style, lineHeight);
    runs.push({
      type: 'text-run',
      text: runText,
      bounds: { x, y: yOffset, width, height: lineHeight },
      style: range.style,
    });
    x += width;
    linePos = rangeEnd;
  }

  return runs;
}

/**
 * Compute the vertical y-offset for a text run based on its vertical-align
 * property. The offset is relative to the line box top.
 *
 * - baseline: no offset (0)
 * - top: align to top of line box (0)
 * - bottom: align to bottom of line box
 * - middle: center in line box
 * - super: shift up by ~0.4em
 * - sub: shift down by ~0.2em
 * - text-top: align to top of text area (0)
 * - text-bottom: align to bottom of text area
 */
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

function findRange(ranges: readonly StyleRange[], globalPos: number): StyleRange | undefined {
  for (const range of ranges) {
    if (globalPos >= range.start && globalPos < range.end) return range;
  }
  return undefined;
}

function findBreakPosition(
  text: string,
  start: number,
  end: number,
  maxWidth: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
): number {
  const fullText = text.slice(start, end);
  if (measurer.measureText(fullText, style).width <= maxWidth) {
    return end;
  }

  let lo = start;
  let hi = end;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    const candidate = text.slice(start, mid);
    if (measurer.measureText(candidate, style).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const wordBreak = findWordBreak(text, start, lo);
  if (wordBreak === lo) {
    const hyphenBreak = tryHyphenation(text, start, lo, maxWidth, style, measurer);
    if (hyphenBreak > start) return hyphenBreak;
  }

  return wordBreak;
}

function findWordBreak(text: string, start: number, fitPos: number): number {
  for (let i = fitPos; i > start; i--) {
    const ch = text[i];
    if (ch === ' ') return i;
    if (ch && CJK_RE.test(ch)) return i;
    const prev = text[i - 1];
    if (prev && CJK_RE.test(prev)) return i;
  }
  return fitPos;
}

function tryHyphenation(
  text: string,
  start: number,
  fitPos: number,
  maxWidth: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
): number {
  let wordStart = fitPos;
  while (wordStart > start && text[wordStart - 1] !== ' ') wordStart--;
  let wordEnd = fitPos;
  while (wordEnd < text.length && text[wordEnd] !== ' ') wordEnd++;

  const word = text.slice(wordStart, wordEnd);
  const points = findHyphenationPoints(word);
  if (points.length === 0) return 0;

  for (let i = points.length - 1; i >= 0; i--) {
    const pt = points[i];
    if (pt === undefined) continue;
    const breakAt = wordStart + pt;
    if (breakAt <= start || breakAt >= fitPos + 2) continue;
    const candidate = text.slice(start, breakAt) + '-';
    if (measurer.measureText(candidate, style).width <= maxWidth) {
      return breakAt;
    }
  }

  return 0;
}
