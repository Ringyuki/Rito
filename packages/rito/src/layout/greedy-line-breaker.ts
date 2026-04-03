import type { ComputedStyle, TextAlignment } from '../style/types';
import type { LineBox, TextRun } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import type { StyledSegment } from './styled-segment';
import type { TextMeasurer } from './text-measurer';

// CJK Unicode ranges where line breaks are allowed between any characters
const CJK_RE =
  /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}\u3000-\u303F\uFF00-\uFFEF]/u;

/** Maps character positions in the concatenated text to their original styles. */
interface StyleRange {
  readonly start: number;
  readonly end: number;
  readonly style: ComputedStyle;
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

      // Build concatenated text and style ranges
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

function layoutText(
  text: string,
  baseStyle: ComputedStyle,
  ranges: readonly StyleRange[],
  maxWidth: number,
  startY: number,
  measurer: TextMeasurer,
): LineBox[] {
  const lines: LineBox[] = [];
  const lineHeight = baseStyle.fontSize * baseStyle.lineHeight;
  const textAlign = baseStyle.textAlign;
  const indent = baseStyle.textIndent;
  const preserveWs = baseStyle.whiteSpace === 'pre' || baseStyle.whiteSpace === 'pre-wrap';
  const allowWrap = baseStyle.whiteSpace !== 'pre' && baseStyle.whiteSpace !== 'nowrap';
  let y = startY;
  let pos = 0;
  let isFirstLine = true;

  while (pos < text.length) {
    // Strip leading spaces unless preserving whitespace
    if (!preserveWs && (!isFirstLine || indent <= 0)) {
      while (pos < text.length && text[pos] === ' ') pos++;
    }
    if (pos >= text.length) break;

    const effectiveMax = isFirstLine && indent > 0 ? maxWidth - indent : maxWidth;
    const lineStartX = isFirstLine && indent > 0 ? indent : 0;

    const nlIndex = text.indexOf('\n', pos);
    const lineEnd = nlIndex >= 0 ? nlIndex : text.length;

    const breakPos = allowWrap
      ? findBreakPosition(text, pos, lineEnd, effectiveMax, baseStyle, measurer)
      : lineEnd; // pre/nowrap: don't wrap, take the whole line

    const lineTextEnd = breakPos <= pos ? pos + 1 : breakPos;
    const lineText = preserveWs ? text.slice(pos, lineTextEnd) : text.slice(pos, lineTextEnd).trimEnd();
    const runs = buildStyledRuns(lineText, pos, lineStartX, lineHeight, ranges, measurer);
    const width = runs.reduce((sum, r) => Math.max(sum, r.bounds.x + r.bounds.width), 0);

    pos = lineTextEnd;
    // Consume newline character(s)
    if (preserveWs) {
      // In pre/pre-wrap, each \n produces a separate line break
      if (pos < text.length && text[pos] === '\n') pos++;
    } else {
      // In normal mode, collapse consecutive newlines
      while (pos < text.length && text[pos] === '\n') pos++;
    }

    const isLastLine = pos >= text.length;
    lines.push(applyAlign(runs, width, y, lineHeight, maxWidth, textAlign, isLastLine));
    y += lineHeight;
    isFirstLine = false;
  }

  return lines;
}

/** Build TextRun objects for a line, splitting at style boundaries. */
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

    // How many characters of this range are left in the line
    const rangeEnd = Math.min(range.end - globalOffset, lineText.length);
    const runText = lineText.slice(linePos, rangeEnd);
    if (runText.length === 0) break;

    const width = measurer.measureText(runText, range.style).width;
    runs.push({
      type: 'text-run',
      text: runText,
      bounds: { x, y: 0, width, height: lineHeight },
      style: range.style,
    });
    x += width;
    linePos = rangeEnd;
  }

  return runs;
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

  return findWordBreak(text, start, lo);
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

function applyAlign(
  runs: TextRun[],
  lineWidth: number,
  y: number,
  lineHeight: number,
  maxWidth: number,
  textAlign: TextAlignment,
  isLastLine: boolean,
): LineBox {
  if (textAlign === 'center' && runs.length > 0) {
    const offset = (maxWidth - lineWidth) / 2;
    runs = runs.map((r) => ({ ...r, bounds: { ...r.bounds, x: r.bounds.x + offset } }));
  } else if (textAlign === 'right' && runs.length > 0) {
    const offset = maxWidth - lineWidth;
    runs = runs.map((r) => ({ ...r, bounds: { ...r.bounds, x: r.bounds.x + offset } }));
  } else if (textAlign === 'justify' && !isLastLine && runs.length > 0) {
    runs = justifyRuns(runs, lineWidth, maxWidth);
  }

  return {
    type: 'line-box',
    bounds: { x: 0, y, width: maxWidth, height: lineHeight },
    runs,
  };
}

/** Distribute extra space between words for justified text. */
function justifyRuns(runs: TextRun[], lineWidth: number, maxWidth: number): TextRun[] {
  // Count word gaps: spaces between text runs, or spaces within runs
  const gaps: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;
    // Count spaces within this run (each space is a gap opportunity)
    for (let j = 0; j < run.text.length; j++) {
      if (run.text[j] === ' ') gaps.push(i);
    }
  }

  if (gaps.length === 0) return runs;

  const extraSpace = maxWidth - lineWidth;
  const gapSize = extraSpace / gaps.length;

  // Rebuild runs with adjusted x positions
  const result: TextRun[] = [];
  let xOffset = 0;
  let gapIdx = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;

    // Count how many gaps are in runs before this one
    while (gapIdx < gaps.length && (gaps[gapIdx] ?? Infinity) < i) {
      xOffset += gapSize;
      gapIdx++;
    }

    // Count gaps within this run and expand
    let intraGaps = 0;
    for (let j = 0; j < run.text.length; j++) {
      if (run.text[j] === ' ') intraGaps++;
    }

    result.push({
      ...run,
      bounds: {
        ...run.bounds,
        x: run.bounds.x + xOffset,
        width: run.bounds.width + intraGaps * gapSize,
      },
    });

    // Advance offset for gaps within this run
    xOffset += intraGaps * gapSize;
    gapIdx += intraGaps;
  }

  return result;
}
