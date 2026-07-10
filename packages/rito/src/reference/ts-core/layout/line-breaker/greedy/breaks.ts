import type { ComputedStyle } from '../../../style/core/types';
import { measurePaintFromStyle } from '../../../style/css/font-shorthand';
import { findHyphenationPoints } from '../../text/hyphenation';
import type { InlineAtomSegment } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import { adjustBreakPosition, getLineBreakOffsets } from '../break-classifier';
import { findStyleRangeAt } from './context';
import type { StyleRange } from './types';

export function findBreakPosition(
  text: string,
  start: number,
  end: number,
  maxWidth: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment> = new Map(),
  ranges?: readonly StyleRange[],
  getBreakOffsets?: () => ReadonlySet<number>,
): BreakPosition {
  if (measureSlice(text, start, end, style, measurer, atoms, ranges) <= maxWidth) {
    return { position: end, hyphenated: false };
  }

  const fitPosition = findFitPosition(text, start, end, maxWidth, style, measurer, atoms, ranges);

  const options = {
    lineBreak: style.lineBreak,
    wordBreak: style.wordBreak,
    language: style.language,
  };
  const breakOffsets = getBreakOffsets?.() ?? getLineBreakOffsets(text, options);
  const measureWidth = (sliceEnd: number): number =>
    measureSlice(text, start, sliceEnd, style, measurer, atoms, ranges);
  const adjustPosition = (candidate: number): number =>
    adjustBreakPosition(text, start, end, candidate, maxWidth, measureWidth, options, breakOffsets);
  const wordBreak = findWordBreak(start, fitPosition, breakOffsets);
  if (wordBreak === fitPosition) {
    const hyphenBreak = tryHyphenation(text, start, fitPosition, maxWidth, style, measurer);
    if (hyphenBreak > start) {
      const position = adjustPosition(hyphenBreak);
      return { position, hyphenated: position === hyphenBreak };
    }
  }

  return {
    position: adjustPosition(wordBreak),
    hyphenated: false,
  };
}

export interface BreakPosition {
  readonly position: number;
  readonly hyphenated: boolean;
}

function findFitPosition(
  text: string,
  start: number,
  end: number,
  maxWidth: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment>,
  ranges?: readonly StyleRange[],
): number {
  let low = start;
  let high = end;
  while (low < high - 1) {
    const mid = (low + high) >>> 1;
    if (measureSlice(text, start, mid, style, measurer, atoms, ranges) <= maxWidth) low = mid;
    else high = mid;
  }
  return low;
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

    const range = findStyleRangeAt(ranges, pos);
    const rangeStyle = range?.style ?? fallbackStyle;
    const rangeEnd = range ? Math.min(range.end, end) : end;
    const sliceEnd = findTextSliceEnd(pos, rangeEnd, atoms);

    width += getRangeStartInset(range, rangeStyle, pos);
    width += measureTextSlice(text, pos, sliceEnd, rangeStyle, measurer);
    width += getRangeEndInset(range, rangeStyle, sliceEnd);

    pos = sliceEnd;
  }

  return width;
}

function findTextSliceEnd(
  pos: number,
  rangeEnd: number,
  atoms: ReadonlyMap<number, InlineAtomSegment>,
): number {
  for (let i = pos; i < rangeEnd; i++) {
    if (atoms.has(i)) return i;
  }
  return rangeEnd;
}

function getRangeStartInset(
  range: StyleRange | undefined,
  style: ComputedStyle,
  pos: number,
): number {
  if (!range || pos !== range.start) return 0;
  let width = range.borderStart ? style.borderLeft.width + style.paddingLeft : 0;
  if (range.inlineMarginLeft) width += range.inlineMarginLeft;
  return width;
}

function measureTextSlice(
  text: string,
  start: number,
  end: number,
  style: ComputedStyle,
  measurer: TextMeasurer,
): number {
  if (end <= start) return 0;
  return measurer.measureText(text.slice(start, end), measurePaintFromStyle(style)).width;
}

function getRangeEndInset(
  range: StyleRange | undefined,
  style: ComputedStyle,
  sliceEnd: number,
): number {
  if (!range || sliceEnd < range.end) return 0;
  let width = range.borderEnd ? style.paddingRight + style.borderRight.width : 0;
  if (range.inlineMarginRight) width += range.inlineMarginRight;
  return width;
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
  const paint = measurePaintFromStyle(style);
  if (atoms.size === 0) {
    return measurer.measureText(text.slice(start, end), paint).width;
  }
  let width = 0;
  let textStart = start;
  for (let i = start; i < end; i++) {
    const atom = atoms.get(i);
    if (atom) {
      if (i > textStart) width += measurer.measureText(text.slice(textStart, i), paint).width;
      width += atom.width;
      textStart = i + 1;
    }
  }
  if (textStart < end) width += measurer.measureText(text.slice(textStart, end), paint).width;
  return width;
}

function findWordBreak(start: number, fitPos: number, offsets: ReadonlySet<number>): number {
  for (let index = fitPos; index > start; index--) {
    if (offsets.has(index)) return index;
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
  const word = findHyphenationWord(text, start, fitPos);
  if (!word) return 0;

  const points = findHyphenationPoints(word.text);
  if (points.length === 0) return 0;

  const paint = measurePaintFromStyle(style);
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index];
    if (point === undefined) continue;

    const breakAt = word.start + point;
    if (breakAt <= start || breakAt >= fitPos + 2) continue;

    const candidate = text.slice(start, breakAt) + '-';
    if (measurer.measureText(candidate, paint).width <= maxWidth) {
      return breakAt;
    }
  }

  return 0;
}

function findHyphenationWord(
  text: string,
  lineStart: number,
  fitPos: number,
): { readonly start: number; readonly text: string } | undefined {
  if (fitPos <= lineStart || !isAsciiLetter(text.charCodeAt(fitPos - 1))) return undefined;

  let wordStart = fitPos;
  while (wordStart > lineStart && isAsciiLetter(text.charCodeAt(wordStart - 1))) wordStart--;

  let wordEnd = fitPos;
  while (wordEnd < text.length && isAsciiLetter(text.charCodeAt(wordEnd))) wordEnd++;

  return wordEnd > wordStart
    ? { start: wordStart, text: text.slice(wordStart, wordEnd) }
    : undefined;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
