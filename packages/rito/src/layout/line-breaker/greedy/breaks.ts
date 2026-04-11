import type { ComputedStyle } from '../../../style/core/types';
import { findHyphenationPoints } from '../../text/hyphenation';
import type { InlineAtomSegment } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import type { StyleRange } from './types';

const CJK_RE =
  /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u{20000}-\u{2FA1F}\u3000-\u303F\uFF00-\uFFEF]/u;

export function findBreakPosition(
  text: string,
  start: number,
  end: number,
  maxWidth: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment> = new Map(),
  ranges?: readonly StyleRange[],
): number {
  if (measureSlice(text, start, end, style, measurer, atoms, ranges) <= maxWidth) {
    return end;
  }

  let lo = start;
  let hi = end;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (measureSlice(text, start, mid, style, measurer, atoms, ranges) <= maxWidth) {
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

/**
 * Measure the width of a text slice. When style ranges are provided,
 * each portion is measured with its own style (correct font-size).
 * Falls back to base style when ranges are not provided.
 */
function measureSlice(
  text: string,
  start: number,
  end: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment>,
  ranges?: readonly StyleRange[],
): number {
  if (!ranges || ranges.length === 0) {
    return measureSliceSimple(text, start, end, style, measurer, atoms);
  }
  return measureSliceRanged(text, start, end, ranges, style, measurer, atoms);
}

/** Measure using per-range styles for accurate mixed font-size measurement. */
function measureSliceRanged(
  text: string,
  start: number,
  end: number,
  ranges: readonly StyleRange[],
  fallbackStyle: ComputedStyle,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment>,
): number {
  let width = 0;
  let pos = start;

  while (pos < end) {
    const atom = atoms.get(pos);
    if (atom) {
      width += atom.width;
      pos++;
      continue;
    }

    const range = findRangeAt(ranges, pos);
    const rangeStyle = range?.style ?? fallbackStyle;
    const rangeEnd = range ? Math.min(range.end, end) : end;

    // Measure text up to the next atom or range boundary
    let sliceEnd = rangeEnd;
    for (let i = pos; i < rangeEnd; i++) {
      if (atoms.has(i)) {
        sliceEnd = i;
        break;
      }
    }

    if (sliceEnd > pos) {
      width += measurer.measureText(text.slice(pos, sliceEnd), rangeStyle).width;
    }
    pos = sliceEnd;
  }

  return width;
}

function findRangeAt(ranges: readonly StyleRange[], pos: number): StyleRange | undefined {
  for (const range of ranges) {
    if (pos >= range.start && pos < range.end) return range;
  }
  return undefined;
}

/** Original simple measurement using a single style (for backward compatibility). */
function measureSliceSimple(
  text: string,
  start: number,
  end: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment>,
): number {
  if (atoms.size === 0) {
    return measurer.measureText(text.slice(start, end), style).width;
  }
  let width = 0;
  let textStart = start;
  for (let i = start; i < end; i++) {
    const atom = atoms.get(i);
    if (atom) {
      if (i > textStart) width += measurer.measureText(text.slice(textStart, i), style).width;
      width += atom.width;
      textStart = i + 1;
    }
  }
  if (textStart < end) width += measurer.measureText(text.slice(textStart, end), style).width;
  return width;
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
