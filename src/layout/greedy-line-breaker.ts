import type { ComputedStyle, TextAlignment } from '../style/types';
import type { LineBox, TextRun } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import type { StyledSegment } from './styled-segment';
import type { TextMeasurer } from './text-measurer';

// CJK Unicode ranges where line breaks are allowed between any characters
const CJK_RE =
  /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}\u3000-\u303F\uFF00-\uFFEF]/u;

/**
 * Greedy paragraph layouter.
 *
 * Uses whole-string measurement to find line break points, ensuring the
 * measured width matches what the canvas actually renders. Supports CJK
 * character-level breaking and Latin word-level breaking.
 */
export function createGreedyLayouter(measurer: TextMeasurer): ParagraphLayouter {
  return {
    layoutParagraph(
      segments: readonly StyledSegment[],
      maxWidth: number,
      startY: number,
    ): readonly LineBox[] {
      if (segments.length === 0) return [];
      // For single-style segments, use the efficient string-based approach
      const style = segments[0]?.style;
      if (!style) return [];
      const fullText = segments.map((s) => s.text).join('');
      if (fullText.trim().length === 0) return [];
      return layoutText(fullText, style, maxWidth, startY, measurer);
    },
  };
}

/**
 * Layout a text string into line boxes using whole-string measurement.
 * Finds break points by measuring candidate substrings directly.
 */
function layoutText(
  text: string,
  style: ComputedStyle,
  maxWidth: number,
  startY: number,
  measurer: TextMeasurer,
): LineBox[] {
  const lines: LineBox[] = [];
  const lineHeight = style.fontSize * style.lineHeight;
  const textAlign = style.textAlign;
  const indent = style.textIndent;
  let y = startY;
  let pos = 0;
  let isFirstLine = true;

  while (pos < text.length) {
    // Skip leading whitespace at start of line (except first line with indent)
    if (!isFirstLine || indent <= 0) {
      while (pos < text.length && text[pos] === ' ') pos++;
    }
    if (pos >= text.length) break;

    const effectiveMax = isFirstLine && indent > 0 ? maxWidth - indent : maxWidth;
    const lineStartX = isFirstLine && indent > 0 ? indent : 0;

    // Handle explicit newlines
    const nlIndex = text.indexOf('\n', pos);
    const lineEnd = nlIndex >= 0 ? nlIndex : text.length;

    // Find how much text fits on this line
    const breakPos = findBreakPosition(text, pos, lineEnd, effectiveMax, style, measurer);

    if (breakPos <= pos) {
      // At least one character must be placed per line to avoid infinite loop
      const minBreak = pos + 1;
      const lineText = text.slice(pos, minBreak);
      const width = measurer.measureText(lineText, style).width;
      lines.push(buildLine(lineText, lineStartX, width, y, lineHeight, maxWidth, style, textAlign));
      y += lineHeight;
      pos = minBreak;
    } else {
      const lineText = text.slice(pos, breakPos).trimEnd();
      const width = measurer.measureText(lineText, style).width;
      lines.push(buildLine(lineText, lineStartX, width, y, lineHeight, maxWidth, style, textAlign));
      y += lineHeight;
      pos = breakPos;
    }

    // Skip past newline character(s)
    while (pos < text.length && text[pos] === '\n') pos++;
    isFirstLine = false;
  }

  return lines;
}

/**
 * Find the best break position for a line using whole-string measurement.
 * Prefers breaking at word boundaries (spaces) and CJK character boundaries.
 */
function findBreakPosition(
  text: string,
  start: number,
  end: number,
  maxWidth: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
): number {
  // Quick check: does the entire remaining text fit?
  const fullText = text.slice(start, end);
  if (measurer.measureText(fullText, style).width <= maxWidth) {
    return end;
  }

  // Binary search for approximate fit point
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

  // lo is the last position where text fits
  // Now find the best break point at or before lo
  return findWordBreak(text, start, lo);
}

/**
 * Find the best word/character break point at or before fitPos.
 * Prefers breaking at spaces or CJK character boundaries.
 */
function findWordBreak(text: string, start: number, fitPos: number): number {
  // Look backwards from fitPos for a good break point
  for (let i = fitPos; i > start; i--) {
    const ch = text[i];
    // Break at space
    if (ch === ' ') return i;
    // Break before or after a CJK character
    if (ch && CJK_RE.test(ch)) return i;
    const prev = text[i - 1];
    if (prev && CJK_RE.test(prev)) return i;
  }
  // No good break point found — break at fitPos (emergency character break)
  return fitPos;
}

function buildLine(
  text: string,
  startX: number,
  textWidth: number,
  y: number,
  lineHeight: number,
  maxWidth: number,
  style: ComputedStyle,
  textAlign: TextAlignment,
): LineBox {
  let x = startX;

  if (textAlign === 'center') {
    x += (maxWidth - startX - textWidth) / 2;
  } else if (textAlign === 'right') {
    x = maxWidth - textWidth;
  }

  const run: TextRun = {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: textWidth, height: lineHeight },
    style,
  };

  return {
    type: 'line-box',
    bounds: { x: 0, y, width: maxWidth, height: lineHeight },
    runs: [run],
  };
}
