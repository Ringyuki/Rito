import type { ComputedStyle } from '../../../style/core/types';
import type { InlineAtomSegment, InlineSegment } from '../../text/styled-segment';
import { isInlineAtom } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import { getLineBreakOffsets } from '../break-classifier';
import type { LineContext, StyleRange } from './types';

/** Object Replacement Character used as placeholder for inline atoms. */
const ORC = '\uFFFC';

export function buildStyleRanges(segments: readonly InlineSegment[]): {
  fullText: string;
  ranges: readonly StyleRange[];
  atoms: ReadonlyMap<number, InlineAtomSegment>;
} {
  const ranges: StyleRange[] = [];
  const textParts: string[] = [];
  const atoms = new Map<number, InlineAtomSegment>();
  let offset = 0;

  for (const segment of segments) {
    if (isInlineAtom(segment)) {
      textParts.push(ORC);
      atoms.set(offset, segment);
      ranges.push({ start: offset, end: offset + 1, style: segment.style });
      offset += 1;
      continue;
    }
    textParts.push(segment.text);
    if (segment.text.length === 0) continue;

    let range: StyleRange = {
      start: offset,
      end: offset + segment.text.length,
      style: segment.style,
      ...(segment.sourceRef ? { sourceRef: segment.sourceRef } : {}),
      ...(segment.sourceText !== undefined ? { sourceText: segment.sourceText } : {}),
      ...(segment.sourceTextOffset !== undefined
        ? { sourceTextOffset: segment.sourceTextOffset }
        : {}),
    };
    if (segment.href) range = { ...range, href: segment.href };
    if (segment.rubyAnnotation) range = { ...range, rubyAnnotation: segment.rubyAnnotation };
    if (segment.borderStart) range = { ...range, borderStart: true };
    if (segment.borderEnd) range = { ...range, borderEnd: true };
    if (segment.inlineMarginLeft) range = { ...range, inlineMarginLeft: segment.inlineMarginLeft };
    if (segment.inlineMarginRight)
      range = { ...range, inlineMarginRight: segment.inlineMarginRight };
    ranges.push(range);
    offset += segment.text.length;
  }

  return { fullText: textParts.join(''), ranges, atoms };
}

export function buildLineContext(
  text: string,
  baseStyle: ComputedStyle,
  ranges: readonly StyleRange[],
  maxWidth: number,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment> = new Map(),
): LineContext {
  let breakOffsets: ReadonlySet<number> | undefined;
  return {
    text,
    baseStyle,
    ranges,
    maxWidth,
    lineHeight: baseStyle.lineHeightPx ?? baseStyle.fontSize * baseStyle.lineHeight,
    measurer,
    preserveWs: baseStyle.whiteSpace === 'pre' || baseStyle.whiteSpace === 'pre-wrap',
    allowWrap: baseStyle.whiteSpace !== 'pre' && baseStyle.whiteSpace !== 'nowrap',
    atoms,
    getBreakOffsets: () => {
      breakOffsets ??= getLineBreakOffsets(text, {
        lineBreak: baseStyle.lineBreak,
        wordBreak: baseStyle.wordBreak,
        language: baseStyle.language,
      });
      return breakOffsets;
    },
  };
}

/** Locate a position in the sorted, non-overlapping ranges built above. */
export function findStyleRangeAt(
  ranges: readonly StyleRange[],
  position: number,
): StyleRange | undefined {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle];
    if (!range) return undefined;
    if (position < range.start) high = middle - 1;
    else if (position >= range.end) low = middle + 1;
    else return range;
  }

  return undefined;
}

export function consumeNewlines(text: string, pos: number, _preserveWs: boolean): number {
  // Consume exactly one newline (from <br>) so each <br> produces its own line break.
  return pos < text.length && text[pos] === '\n' ? pos + 1 : pos;
}
