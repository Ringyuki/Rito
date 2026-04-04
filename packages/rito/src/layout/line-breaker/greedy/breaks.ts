import type { ComputedStyle } from '../../../style/types';
import { findHyphenationPoints } from '../../text/hyphenation';
import type { TextMeasurer } from '../../text/text-measurer';

const CJK_RE =
  /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}\u3000-\u303F\uFF00-\uFFEF]/u;

export function findBreakPosition(
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
  for (let index = fitPos; index > start; index--) {
    const char = text[index];
    if (char === ' ') return index;
    if (char && CJK_RE.test(char)) return index;

    const prev = text[index - 1];
    if (prev && CJK_RE.test(prev)) return index;
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

  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index];
    if (point === undefined) continue;

    const breakAt = wordStart + point;
    if (breakAt <= start || breakAt >= fitPos + 2) continue;

    const candidate = text.slice(start, breakAt) + '-';
    if (measurer.measureText(candidate, style).width <= maxWidth) {
      return breakAt;
    }
  }

  return 0;
}
